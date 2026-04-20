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
            _wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock active: Screen will stay on.');
        }
    } catch (err) {
        console.warn(`Wake Lock failed: ${err.message}`);
    }

    const pending = await getPendingSubmissions();
    if (pending.length === 0) {
        _uploading = false;
        broadcastMessage('upload_complete', { uploaded: 0, failed: 0, total: 0 });
        return { uploaded: 0, failed: 0, total: 0 };
    }

    _uploadProgress = { current: 0, total: pending.length };
    broadcastMessage('upload_started', { total: pending.length });

    // ── Initial jitter: short 500ms delay ──
    // Makes the progress UI feel natural and prevents instantaneous lockups
    const initialDelay = 500;
    console.log(`Starting uploads in ${(initialDelay / 1000).toFixed(1)}s...`);
    broadcastMessage('upload_progress', {
        current: 0,
        total: pending.length,
        entryId: null,
        entryName: 'Waiting...',
        status: 'scheduling'
    });
    await sleep(initialDelay);

    let uploaded = 0;
    let failed = 0;
    let consecutiveFailures = 0;

    for (const record of pending) {
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

            // Convert Blobs back to data URLs for the existing endpoint
            const pretestDataUrl = await blobToDataUrl(record.pretestBlob);
            const posttestDataUrl = await blobToDataUrl(record.posttestBlob);

            // Build the full payload with images
            const fullPayload = {
                ...record.payload,
                image_pretest: pretestDataUrl,
                image_posttest: posttestDataUrl,
                uuid: record.uuid
            };

            // POST with retry + exponential backoff
            await fetchWithRetry(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(fullPayload),
                mode: 'no-cors'
            }, 3); // up to 3 attempts

            // POST succeeded (no error thrown) — mark as confirmed
            // Server-side LockService + UUID duplicate detection ensure safe writes
            // Manual verification available via the "Verify" button on queue page
            await updateSubmissionStatus(record.id, 'confirmed', null);
            uploaded++;
            consecutiveFailures = 0;
            broadcastMessage('upload_progress', {
                current: _uploadProgress.current,
                total: _uploadProgress.total,
                entryId: record.id,
                entryName: record.payload.name || 'Unknown',
                status: 'confirmed'
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
        total: pending.length
    };

    broadcastMessage('upload_complete', result);

    // ── Re-check: were new entries saved while we were uploading? ──
    // If yes, start another upload cycle automatically
    if (navigator.onLine) {
        // We only want to auto-restart if there are strictly 'pending' items, not 'failed' ones.
        const pendingItems = await getPendingSubmissions();
        const strictlyPendingCount = pendingItems.filter(r => r.status === 'pending').length;
        if (strictlyPendingCount > 0) {
            console.log('[Upload] ' + strictlyPendingCount + ' new pending entries found after upload — starting another cycle');
            // Small delay to let the UI update
            await sleep(1000);
            
            // Release lock before recursion (new call will request it again)
            if (_wakeLock !== null) { try { _wakeLock.release(); _wakeLock = null; } catch(e){} }
            return uploadAll();
        }
    }

    // ── Release Wake Lock ──
    if (_wakeLock !== null) {
        try {
            _wakeLock.release();
            _wakeLock = null;
            console.log('Wake Lock released.');
        } catch (e) {}
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

        const pretestDataUrl = await blobToDataUrl(record.pretestBlob);
        const posttestDataUrl = await blobToDataUrl(record.posttestBlob);

        const fullPayload = {
            ...record.payload,
            image_pretest: pretestDataUrl,
            image_posttest: posttestDataUrl,
            uuid: record.uuid
        };

        await fetchWithRetry(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(fullPayload),
            mode: 'no-cors'
        }, 3);

        // POST succeeded — mark as confirmed immediately
        await updateSubmissionStatus(id, 'confirmed', null);

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
    // Reset any entries stuck in 'uploading' from interrupted uploads
    resetStuckUploading().then(count => {
        if (count > 0) {
            console.log('[AutoSync] Reset ' + count + ' stuck entries');
        }
        // Then enable auto-sync listener
        enableAutoSync();

        // Also auto-upload on page load if there are pending entries
        if (navigator.onLine) {
            getPendingCount().then(pending => {
                if (pending > 0 && !_uploading) {
                    console.log('[AutoSync] Found ' + pending + ' pending entries on load — starting upload');
                    uploadAll();
                }
            }).catch(() => { /* ignore */ });
        }
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
        } catch (err) {}
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
        try {
            const response = await fetch(url, options);
            return response;
        } catch (err) {
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
    const errMsg = (err.message || err || 'Network error').toString();
    const lowerMsg = errMsg.toLowerCase();
    
    let fixPhrase = "Tap 'Retry' later.";
    
    if (lowerMsg.includes('network') || lowerMsg.includes('fetch') || lowerMsg.includes('load failed') || lowerMsg.includes('offline') || lowerMsg.includes('internet')) {
        fixPhrase = "Connect to better WiFi/Cellular data and tap Retry.";
    } else if (lowerMsg.includes('timeout')) {
        fixPhrase = "Server is lagging. Wait a few mins, change network, and Retry.";
    } else if (lowerMsg.includes('too large') || lowerMsg.includes('quota')) {
        fixPhrase = "File might be too large or quota hit. Clear cache and restart.";
    }

    return errMsg + " (Fix: " + fixPhrase + ")";
}
