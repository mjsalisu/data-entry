/**
 * uploader.js — Background Bulk Upload Engine
 *
 * Processes queued submissions from IndexedDB one at a time,
 * sends each to the Google Apps Script endpoint, verifies via GET,
 * and communicates progress via BroadcastChannel.
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

    let uploaded = 0;
    let failed = 0;

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

            // POST to Google Apps Script
            await fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(fullPayload),
                mode: 'no-cors'
            });

            // Wait before verification (give Apps Script time to process)
            await sleep(1500);

            // Verify via GET
            const verified = await verifyUpload(record.uuid);

            if (verified) {
                await updateSubmissionStatus(record.id, 'confirmed', null);
                uploaded++;
                broadcastMessage('upload_progress', {
                    current: _uploadProgress.current,
                    total: _uploadProgress.total,
                    entryId: record.id,
                    entryName: record.payload.name || 'Unknown',
                    status: 'confirmed'
                });
            } else {
                // POST likely succeeded (no-cors), but couldn't verify
                // Mark as uploaded (not confirmed) — user can verify later
                await updateSubmissionStatus(record.id, 'uploaded', 'Upload sent but not yet verified');
                uploaded++;
                broadcastMessage('upload_progress', {
                    current: _uploadProgress.current,
                    total: _uploadProgress.total,
                    entryId: record.id,
                    entryName: record.payload.name || 'Unknown',
                    status: 'uploaded'
                });
            }

        } catch (err) {
            console.error('Upload failed for entry', record.id, err);
            await updateSubmissionStatus(record.id, 'failed', err.message || 'Network error');
            failed++;
            broadcastMessage('upload_progress', {
                current: _uploadProgress.current,
                total: _uploadProgress.total,
                entryId: record.id,
                entryName: record.payload.name || 'Unknown',
                status: 'failed',
                error: err.message
            });
        }

        // Delay between uploads to respect Apps Script quotas
        if (_uploadProgress.current < _uploadProgress.total && !_paused) {
            await sleep(500);
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

        await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(fullPayload),
            mode: 'no-cors'
        });

        await sleep(1500);
        const verified = await verifyUpload(record.uuid);

        if (verified) {
            await updateSubmissionStatus(id, 'confirmed', null);
        } else {
            await updateSubmissionStatus(id, 'uploaded', 'Upload sent but not yet verified');
        }

        broadcastMessage('entry_updated', { entryId: id, status: verified ? 'confirmed' : 'uploaded' });
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
    enableAutoSync();
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
