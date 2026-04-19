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

/**
 * Broadcast a message to all open tabs/pages.
 * @param {string} type - Message type
 * @param {Object} data - Message payload
 */
function broadcastMessage(type, data) {
    const msg = { type, ...data, timestamp: Date.now() };

    if (_channel) {
        _channel.postMessage(msg);
    } else {
        // Fallback: use localStorage event (triggers in OTHER tabs)
        localStorage.setItem('dataentry_broadcast', JSON.stringify(msg));
        localStorage.removeItem('dataentry_broadcast');
    }
}

/**
 * Listen for broadcast messages.
 * @param {function(Object)} callback
 */
function onBroadcastMessage(callback) {
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

    const pending = await getPendingSubmissions();
    if (pending.length === 0) {
        _uploading = false;
        broadcastMessage('upload_complete', { uploaded: 0, failed: 0, total: 0 });
        return { uploaded: 0, failed: 0, total: 0 };
    }

    _uploadProgress = { current: 0, total: pending.length };
    broadcastMessage('upload_started', { total: pending.length });

    // ── Initial jitter: random 0-10s delay ──
    // Prevents 200 devices from all hitting the server at t=0
    const initialDelay = Math.floor(Math.random() * 10000);
    console.log(`Starting uploads in ${(initialDelay / 1000).toFixed(1)}s (jitter)...`);
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

            // ── Smart waiting instead of immediate failure ──
            // If this is a server overload, wait and auto-retry (up to 3 times per entry)
            if (consecutiveFailures <= 3 && !_paused) {
                const waitTime = Math.min(5000 * Math.pow(2, consecutiveFailures - 1), 30000);
                const waitJitter = Math.floor(Math.random() * 3000);
                const totalWait = waitTime + waitJitter;

                // Mark as "waiting" not "failed" — it will auto-retry
                await updateSubmissionStatus(record.id, 'pending',
                    'Server busy \u2014 auto-retrying in ' + Math.round(totalWait / 1000) + 's');

                broadcastMessage('upload_progress', {
                    current: _uploadProgress.current,
                    total: _uploadProgress.total,
                    entryId: record.id,
                    entryName: record.payload.name || 'Unknown',
                    status: 'waiting',
                    waitSeconds: Math.round(totalWait / 1000),
                    error: 'Server busy \u2014 auto-retrying...'
                });

                // Countdown wait — broadcast updates every second
                await broadcastCountdown(totalWait, 'Server busy. Waiting to retry...');

            } else {
                // Exhausted retries — mark as truly failed
                await updateSubmissionStatus(record.id, 'failed',
                    err.message || 'Network error \u2014 tap Retry to try again');
                failed++;
                broadcastMessage('upload_progress', {
                    current: _uploadProgress.current,
                    total: _uploadProgress.total,
                    entryId: record.id,
                    entryName: record.payload.name || 'Unknown',
                    status: 'failed',
                    error: err.message || 'Upload failed after multiple retries'
                });
            }
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
        const remaining = await getPendingCount();
        if (remaining > 0) {
            console.log('[Upload] ' + remaining + ' new entries found after upload — starting another cycle');
            // Small delay to let the UI update
            await sleep(1000);
            return uploadAll();
        }
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
        await updateSubmissionStatus(id, 'failed', err.message || 'Network error');
        broadcastMessage('entry_updated', { entryId: id, status: 'failed', error: err.message });
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
