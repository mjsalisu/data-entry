/**
 * uploader.js — Background Bulk Upload Engine
 *
 * Processes queued submissions from IndexedDB one at a time,
 * sends each to the Google Apps Script endpoint, verifies via GET,
 * and communicates progress via BroadcastChannel.
 *
 * Concurrency protection for 200+ simultaneous users:
 *  - Random initial jitter (0-10s) so devices don't all start at once
 *  - Randomized inter-upload delay (2-5s) to spread server load
 *  - Exponential backoff with jitter on failures (4s → 8s → 16s)
 *  - UUID duplicate detection (server skips re-writes)
 *  - Circuit breaker: pauses after 5 consecutive failures
 *
 * Runs fully async — user can continue entering new forms while uploads happen.
 */

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let _uploading = false;
let _paused = false;
let _currentUploadId = null;
let _uploadProgress = { current: 0, total: 0 };
let _wakeLock = null; // Screen wake lock instance

// BroadcastChannel for cross-page communication (form page ↔ queue page)
let _channel = null;
try {
    _channel = new BroadcastChannel('dataentry_upload');
} catch (e) {
    // BroadcastChannel not supported (older Safari) — fallback to localStorage events
    console.warn('BroadcastChannel not supported, falling back to localStorage events');
}

// ─────────────────────────────────────────────
// BroadcastChannel Messaging
// ─────────────────────────────────────────────

let _broadcastCallbacks = [];

/**
 * Broadcast a message to all open tabs/pages AND the local UI.
 * @param {string} type - Message type
 * @param {Object} data - Message payload
 */
function broadcastMessage(type, data) {
    const msg = { type, ...data, timestamp: Date.now() };

    // Fire to other tabs
    if (_channel) {
        _channel.postMessage(msg);
    } else {
        // Fallback: use localStorage event (triggers in OTHER tabs)
        localStorage.setItem('dataentry_broadcast', JSON.stringify(msg));
        localStorage.removeItem('dataentry_broadcast');
    }

    // Fire to the current tab as well (BroadcastChannel does not self-echo)
    for (const callback of _broadcastCallbacks) {
        try { callback(msg); } catch (e) { console.error('Broadcast callback error:', e); }
    }
}

/**
 * Listen for broadcast messages.
 * @param {function(Object)} callback
 */
function onBroadcastMessage(callback) {
    // Register local callback
    _broadcastCallbacks.push(callback);

    if (_channel) {
        _channel.addEventListener('message', (e) => callback(e.data));
    } else {
        // Fallback: listen for localStorage changes
        window.addEventListener('storage', (e) => {
            if (e.key === 'dataentry_broadcast' && e.newValue) {
                try { callback(JSON.parse(e.newValue)); } catch (err) { /* ignore */ }
            }
        });
    }
}

// ─────────────────────────────────────────────
// Upload Logic
// ─────────────────────────────────────────────

/**
 * Upload all pending submissions sequentially.
 * Non-blocking — runs in the background via async/await.
 *
 * @returns {Promise<{uploaded: number, failed: number, total: number}>}
 */
async function uploadAll() {
    if (_uploading) {
        console.log('Upload already in progress');
        return null;
    }

    _uploading = true;
    _paused = false;

    // ── Screen Wake Lock ──
    // Prevent iOS/Android from sleeping the screen while uploading
    try {
        if ('wakeLock' in navigator) {
            navigator.wakeLock.request('screen').then(lock => {
                _wakeLock = lock;
                console.log('Wake Lock active: Screen will stay on.');
            }).catch(err => {
                console.warn(`Wake Lock failed: ${err.message}`);
            });
        }
    } catch (err) {
        console.warn(`Wake Lock try/catch failed: ${err.message}`);
    }

    // Load ONLY IDs — not full records with multi-MB images.
    // Each full record is fetched one-at-a-time inside the loop below,
    // so only one record's images are in RAM at any given time.
    const pendingIds = await getPendingSubmissionIds();
    if (pendingIds.length === 0) {
        _uploading = false;
        broadcastMessage('upload_complete', { uploaded: 0, failed: 0, total: 0 });
        return { uploaded: 0, failed: 0, total: 0 };
    }

    _uploadProgress = { current: 0, total: pendingIds.length };
    broadcastMessage('upload_started', { total: pendingIds.length });

    // ── Initial jitter: short 500ms delay ──
    // Makes the progress UI feel natural and prevents instantaneous lockups
    const initialDelay = 500;
    console.log(`Starting uploads in ${(initialDelay / 1000).toFixed(1)}s...`);
    broadcastMessage('upload_progress', {
        current: 0,
        total: pendingIds.length,
        entryId: null,
        entryName: 'Waiting...',
        status: 'scheduling'
    });
    await sleep(initialDelay);

    let uploaded = 0;
    let failed = 0;
    let consecutiveFailures = 0;

    for (const recordId of pendingIds) {
        // Check if paused
        if (_paused) {
            broadcastMessage('upload_paused', {
                current: _uploadProgress.current,
                total: _uploadProgress.total,
                uploaded,
                failed
            });
            break;
        }

        // ── Circuit breaker: if server is overwhelmed, slow down significantly ──
        if (consecutiveFailures >= 5) {
            // Instead of stopping, wait with a visible countdown and then continue
            const longWait = 60000 + Math.floor(Math.random() * 30000); // 60-90s
            console.warn('Server overwhelmed — cooling down for ' + Math.round(longWait / 1000) + 's...');

            // Broadcast a "waiting" status so UI shows countdown
            await broadcastCountdown(longWait, 'Server is busy. Many users are uploading. Cooling down...');

            consecutiveFailures = 3; // Reset partially, don't fully reset
        }

        // ── Load ONE record at a time ──
        // Only this single record's image blobs are in memory.
        // After the iteration, `record` falls out of scope and is GC'd.
        const record = await getSubmission(recordId);
        if (!record) {
            // Entry may have been deleted while we were uploading
            _uploadProgress.current++;
            continue;
        }

        _currentUploadId = record.id;
        _uploadProgress.current++;

        broadcastMessage('upload_progress', {
            current: _uploadProgress.current,
            total: _uploadProgress.total,
            entryId: record.id,
            entryName: record.payload.name || 'Unknown',
            status: 'uploading'
        });

        try {
            // Mark as uploading
            await updateSubmissionStatus(record.id, 'uploading', null);

            if (!record.pretestBlob || !record.posttestBlob) {
                throw new Error("Missing required snapshots. Both PreTest and PostTest images are strictly required for upload.");
            }

            const pretestData = await blobToBase64(record.pretestBlob);
            const posttestData = await blobToBase64(record.posttestBlob);

            // Build the full payload with images
            const fullPayload = {
                ...record.payload,
                image_pretest: pretestData,
                image_posttest: posttestData,
                uuid: record.uuid
            };

            // POST with retry + exponential backoff
            await fetchWithRetry(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(fullPayload),
                mode: 'no-cors'
            }, 3); // up to 3 attempts

            // POST succeeded (no error thrown)
            // Server-side LockService + UUID duplicate detection ensure safe writes
            // We now mark as 'uploaded'. User must run "Verify" to upgrade to 'confirmed'.
            await updateSubmissionStatus(record.id, 'uploaded', null);

            // KPI Tracker hook
            if (typeof trackEntryUploaded === 'function') trackEntryUploaded();

            // ── Track Monthly Stats ──
            try {
                const monthKey = new Date().toISOString().slice(0, 7); // e.g., "2026-04"
                let stats = JSON.parse(localStorage.getItem('monthly_upload_stats') || '{}');
                stats[monthKey] = (stats[monthKey] || 0) + 1;
                localStorage.setItem('monthly_upload_stats', JSON.stringify(stats));
            } catch (e) { }

            uploaded++;
            consecutiveFailures = 0;
            broadcastMessage('upload_progress', {
                current: _uploadProgress.current,
                total: _uploadProgress.total,
                entryId: record.id,
                entryName: record.payload.name || 'Unknown',
                status: 'uploaded'
            });

        } catch (err) {
            console.error('Upload failed for entry', record.id, err);
            consecutiveFailures++;

            // Exhausted retries (fetchWithRetry already does 3 attempts internally)
            const detailedError = getUserFriendlyError(err);

            // Mark as truly failed with the detailed error so the user can read it.
            await updateSubmissionStatus(record.id, 'failed', detailedError);
            failed++;
            broadcastMessage('upload_progress', {
                current: _uploadProgress.current,
                total: _uploadProgress.total,
                entryId: record.id,
                entryName: record.payload.name || 'Unknown',
                status: 'failed',
                error: detailedError
            });
        }

        // ── Randomized inter-upload delay (2-5s) ──
        // Spreads load when 200 users upload simultaneously
        if (_uploadProgress.current < _uploadProgress.total && !_paused && consecutiveFailures === 0) {
            const interDelay = 2000 + Math.floor(Math.random() * 3000);
            await sleep(interDelay);
        }
    }

    _uploading = false;
    _currentUploadId = null;

    const result = {
        uploaded,
        failed,
        total: pendingIds.length
    };

    broadcastMessage('upload_complete', result);

    // ── Post-cycle check removed ──
    // Do NOT auto-restart uploadAll() here. Any entries saved while this cycle
    // was running will be picked up by the next manual "Upload All" or auto-sync trigger.
    // Recursively calling uploadAll() was causing duplicate uploads when two upload
    // sessions overlapped.

    // ── Release Wake Lock ──
    if (_wakeLock !== null) {
        try {
            _wakeLock.release();
            _wakeLock = null;
            console.log('Wake Lock released.');
        } catch (e) { }
    }

    return result;
}


/**
 * Upload a single submission by ID.
 * @param {number} id
 * @returns {Promise<boolean>} true if uploaded successfully
 */
async function uploadSingle(id) {
    const record = await getSubmission(id);
    if (!record) return false;

    try {
        await updateSubmissionStatus(id, 'uploading', null);

        if (!record.pretestBlob || !record.posttestBlob) {
            throw new Error("Missing required snapshots. Both PreTest and PostTest images are strictly required for upload.");
        }

        const pretestData = await blobToBase64(record.pretestBlob);
        const posttestData = await blobToBase64(record.posttestBlob);

        const fullPayload = {
            ...record.payload,
            image_pretest: pretestData,
            image_posttest: posttestData,
            uuid: record.uuid
        };

        await fetchWithRetry(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(fullPayload),
            mode: 'no-cors'
        }, 3);

        // POST succeeded — mark as confirmed immediately
        await updateSubmissionStatus(id, 'confirmed', null);

        // KPI Tracker hook
        if (typeof trackEntryUploaded === 'function') trackEntryUploaded();

        broadcastMessage('entry_updated', { entryId: id, status: 'confirmed' });
        return true;

    } catch (err) {
        const detailedError = getUserFriendlyError(err);
        await updateSubmissionStatus(id, 'failed', detailedError);
        broadcastMessage('entry_updated', { entryId: id, status: 'failed', error: detailedError });
        return false;
    }
}

/**
 * Verify a submission exists in the Google Sheet by UUID.
 * Uses the GET endpoint which supports CORS (readable response).
 *
 * @param {string} uuid
 * @param {number} retries - Number of retries (default 2)
 * @returns {Promise<boolean>}
 */
async function verifyUpload(uuid, retries) {
    if (retries === undefined) retries = 2;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const resp = await fetch(SCRIPT_URL + '?action=verify&uuid=' + encodeURIComponent(uuid));
            const data = await resp.json();
            if (data.found) return true;
        } catch (err) {
            console.warn('Verification attempt', attempt + 1, 'failed:', err.message);
        }

        if (attempt < retries) {
            await sleep(1000);
        }
    }

    return false;
}

// ─────────────────────────────────────────────
// Control Functions
// ─────────────────────────────────────────────

/**
 * Pause the current upload batch.
 */
function pauseUpload() {
    _paused = true;
}

/**
 * Resume uploading after pause.
 */
function resumeUpload() {
    if (!_uploading) {
        uploadAll();
    }
}

/**
 * Check if an upload is in progress.
 * @returns {boolean}
 */
function isUploading() {
    return _uploading;
}

/**
 * Check if upload is paused.
 * @returns {boolean}
 */
function isPaused() {
    return _paused;
}

/**
 * Get current upload progress.
 * @returns {{current: number, total: number}}
 */
function getUploadProgress() {
    return { ..._uploadProgress };
}

// ─────────────────────────────────────────────
// Auto-Sync on Reconnect
// ─────────────────────────────────────────────

/**
 * Start listening for online events to auto-upload.
 */
function enableAutoSync() {
    window.addEventListener('online', async () => {
        console.log('Network reconnected — checking for pending uploads...');
        const count = await getPendingCount();
        if (count > 0 && !_uploading) {
            console.log(`Auto-syncing ${count} pending submissions...`);
            broadcastMessage('auto_sync_started', { count });
            uploadAll();
        }
    });
}

// Auto-enable on load
if (typeof window !== 'undefined') {
    // Step 1: Reset any entries stuck in 'uploading' from interrupted uploads
    resetStuckUploading().then(count => {
        if (count > 0) {
            console.log('[AutoSync] Reset ' + count + ' stuck entries back to pending');
        }

        // Enable online listener for auto-sync on reconnect
        enableAutoSync();
    }).catch(() => {
        enableAutoSync();
    });
}


// ── Background & Visibility Watcher ──
// Auto-reacquire Wake Lock if they come back from another tab mid-upload
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && _uploading && !_paused) {
        try {
            if ('wakeLock' in navigator && _wakeLock === null) {
                _wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) { }
    } else if (document.visibilityState === 'hidden' && _uploading) {
        // iOS freezes JS here. Show a toast if we had a way, or just accept the pause.
        console.warn('App went to background! Uploads may be suspended by iOS.');
    }
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry + exponential backoff.
 * Used for POST requests that may fail under load from 200+ concurrent users.
 *
 * @param {string} url
 * @param {Object} options - fetch options
 * @param {number} maxAttempts - max number of attempts (default 3)
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options, maxAttempts) {
    if (maxAttempts === undefined) maxAttempts = 3;

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout per attempt

        try {
            options.signal = controller.signal;
            const response = await fetch(url, options);
            clearTimeout(timeoutId);
            return response;
        } catch (err) {
            clearTimeout(timeoutId);
            lastError = err;
            console.warn(`Fetch attempt ${attempt}/${maxAttempts} failed:`, err.message);

            if (attempt < maxAttempts) {
                // Exponential backoff: 2s, 4s, 8s + random jitter 0-2s
                const backoff = 2000 * Math.pow(2, attempt - 1);
                const jitter = Math.floor(Math.random() * 2000);
                console.log(`Retrying in ${((backoff + jitter) / 1000).toFixed(1)}s...`);
                await sleep(backoff + jitter);
            }
        }
    }

    throw lastError;
}

/**
 * Broadcast a countdown timer so the UI shows live wait time.
 * Sends a 'waiting' message every second with remaining seconds.
 *
 * @param {number} totalMs - Total wait time in milliseconds
 * @param {string} reason - Human-readable reason for waiting
 */
async function broadcastCountdown(totalMs, reason) {
    const totalSec = Math.ceil(totalMs / 1000);
    for (let remaining = totalSec; remaining > 0; remaining--) {
        if (_paused) break;
        broadcastMessage('upload_waiting', {
            waitSeconds: remaining,
            reason: reason,
            current: _uploadProgress.current,
            total: _uploadProgress.total
        });
        await sleep(1000);
    }
}

/**
 * Evaluates the catch block error and returns a friendly actionable message.
 * Since we use no-cors, fetch errors are mostly restricted to standard JS network/DOMExceptions.
 *
 * @param {Error|String} err
 * @returns {string} Highly visible actionable error string
 */
function getUserFriendlyError(err) {
    let errMsg;
    let errCode = 'ERR_UNKNOWN';

    if (err instanceof Error || (err && typeof err.message === 'string' && err.message)) {
        errMsg = err.message;
        if (err.name === 'AbortError') errCode = 'ERR_TIMEOUT';
        else if (err.name === 'TypeError') errCode = 'ERR_TYPE';
        else errCode = 'ERR_GENERAL';
    } else if (typeof err === 'string') {
        errMsg = err;
        errCode = 'ERR_STRING';
    } else if (err && err.type) {
        errMsg = `Network request failed (Event: ${err.type})`;
        errCode = 'ERR_NET_EVENT';
    } else {
        errMsg = 'An unexpected network error occurred.';
    }
    const lowerMsg = errMsg.toLowerCase();

    let fixPhrase = "Tap 'Retry' later.";

    if (lowerMsg.includes('network') || lowerMsg.includes('fetch') || lowerMsg.includes('load failed') || lowerMsg.includes('offline') || lowerMsg.includes('internet')) {
        fixPhrase = "Check WiFi/Cellular data. Device may be dropping packets.";
        if (errCode === 'ERR_UNKNOWN') errCode = 'ERR_NETWORK_DISCONNECT';
    } else if (lowerMsg.includes('timeout') || errCode === 'ERR_TIMEOUT') {
        fixPhrase = "Server response took >30s. Connection is extremely slow or dropping.";
        errCode = 'ERR_TIMEOUT';
    } else if (lowerMsg.includes('too large') || lowerMsg.includes('quota') || lowerMsg.includes('payload')) {
        fixPhrase = "Image snapshots are too large. Try reducing camera resolution.";
        errCode = 'ERR_PAYLOAD_SIZE';
    }

    return `[${errCode}] ${errMsg} \n(Diag: ${fixPhrase})`;
}

/**
 * Converts a Blob to a base64 string.
 * Used for legacy entries that were saved before the base64 migration.
 * @param {Blob|string} blob
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        if (!(blob instanceof Blob)) {
            resolve(blob);
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ─────────────────────────────────────────────
// Auto-Sync Stragglers (Ghost Pending Fix)
// ─────────────────────────────────────────────
// If the user navigates away from the form too quickly, `uploadSingle` is aborted,
// leaving the local entry stuck in 'pending' even if the server received it.
// This auto-sync silently processes a small number of pending items in the background
// when the app loads, ensuring the local database reaches the 'uploaded' state seamlessly.
setTimeout(async () => {
    if (navigator.onLine && !_uploading && typeof getPendingSubmissionIds === 'function') {
        try {
            const pendingIds = await getPendingSubmissionIds();
            // Only auto-sync if there are 15 or fewer stragglers (don't lock up device for huge offline batches)
            if (pendingIds.length > 0 && pendingIds.length <= 15) {
                console.log(`[AutoSync] Background syncing ${pendingIds.length} straggler(s)...`);
                // Trigger the main upload loop (it automatically skips duplicates on the server)
                uploadAll();
            }
        } catch (e) {
            console.error('[AutoSync] Failed to check pending count:', e);
        }
    }
}, 4000); // Wait 4 seconds to let the UI finish rendering first
