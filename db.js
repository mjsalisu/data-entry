/**
 * db.js — IndexedDB Storage Layer for Offline Submissions
 *
 * Uses the 'idb' wrapper library (loaded via CDN in HTML) for clean async/await API.
 * Database: DataEntryDB
 * Object Store: submissions (autoIncrement key)
 *
 * Submission lifecycle: pending → uploading → uploaded → confirmed (→ cleared by user)
 */

const DB_NAME = 'DataEntryDB';
const DB_VERSION = 1;
const STORE_NAME = 'submissions';

/** @type {import('idb').IDBPDatabase|null} */
let _dbInstance = null;

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBPDatabase>}
 */
async function openDB() {
    if (_dbInstance) return _dbInstance;

    _dbInstance = await idb.openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true
                });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('createdAt', 'createdAt', { unique: false });
                store.createIndex('uuid', 'uuid', { unique: true });
            }
        }
    });

    return _dbInstance;
}

// ─────────────────────────────────────────────
// Utility: Data URL ↔ Blob conversion
// ─────────────────────────────────────────────

// Utility functions for converting Data URLs and Blobs have been removed
// as the application now strictly uses base64 strings to prevent iOS Safari 
// IndexedDB Blob invalidation bugs.

/**
 * Generate a UUID v4 for submission tracking.
 * @returns {string}
 */
function generateUUID() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ─────────────────────────────────────────────
// CRUD Operations
// ─────────────────────────────────────────────

/**
 * Save a completed form submission to IndexedDB.
 * Images are converted from data URLs to Blobs for storage efficiency.
 *
 * @param {Object} payload - The full form payload (text fields)
 * @param {Object} images - { pretest: dataUrl, posttest: dataUrl }
 * @returns {Promise<{id: number, uuid: string}>} The saved record's id and uuid
 */
async function saveSubmission(payload, images) {
    const db = await openDB();
    const uuid = generateUUID();

    const record = {
        uuid: uuid,
        payload: payload,
        pretestBlob: images.pretest || '',
        posttestBlob: images.posttest || '',
        status: 'pending',
        createdAt: new Date(),
        uploadedAt: null,
        error: null
    };

    const id = await db.add(STORE_NAME, record);
    return { id, uuid };
}

/**
 * Get all submissions ready to upload.
 * Only returns 'pending' entries — NOT 'uploading' or 'failed'.
 *
 * WHY we exclude 'uploading':
 *   An entry is set to 'uploading' the moment uploadAll() starts sending it.
 *   If a second uploadAll() call fires (race with auto-sync or user button),
 *   including 'uploading' entries here would cause that same entry to be
 *   POSTed again → duplicate row in Google Sheets.
 *   resetStuckUploading() handles genuinely orphaned 'uploading' entries
 *   (from app crash / navigation away) by resetting them back to 'pending'.
 *
 * WHY we exclude 'failed':
 *   Failed entries require the user to tap "Retry Failed" explicitly.
 *   Auto-including them here created surprise re-uploads.
 *
 * @returns {Promise<Array>}
 */
async function getPendingSubmissions() {
    const db = await openDB();
    // Only return 'pending' entries — NOT 'uploading' (already being processed)
    // See getPendingSubmissionIds() for full explanation of why.
    const pending = await db.getAllFromIndex(STORE_NAME, 'status', 'pending');
    return pending;
}

/**
 * Get all submissions (for the queue UI).
 * Sorted by createdAt descending (newest first).
 * @returns {Promise<Array>}
 */
async function getAllSubmissions() {
    const db = await openDB();
    const all = await db.getAll(STORE_NAME);
    return all.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Get all submissions WITHOUT image data (for list rendering).
 *
 * WHY this exists:
 *   getAllSubmissions() loads every field including pretestBlob and posttestBlob,
 *   which are multi-MB base64 strings. With 200+ entries, this can consume
 *   500MB–1GB+ of RAM, crashing Chrome on Android ("Aw, Snap!").
 *   This function uses a cursor to copy only the metadata fields needed
 *   for the queue list UI, keeping memory usage under a few MB.
 *
 * @returns {Promise<Array>}
 */
async function getAllSubmissionsLight() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const results = [];
    let cursor = await tx.store.openCursor();

    while (cursor) {
        const r = cursor.value;
        results.push({
            id: r.id,
            uuid: r.uuid,
            payload: r.payload,  // Text fields only (~1-2KB each)
            status: r.status,
            createdAt: r.createdAt,
            uploadedAt: r.uploadedAt,
            error: r.error
            // Deliberately omit pretestBlob and posttestBlob (~2-5MB each)
        });
        cursor = await cursor.continue();
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Get IDs of all pending submissions ready for upload.
 * Only loads keys, not full records — prevents memory exhaustion
 * when there are 100+ entries with large image data.
 *
 * WHY only 'pending' (not 'uploading'):
 *   An entry is set to 'uploading' the moment uploadAll() starts sending it.
 *   Including 'uploading' entries here would cause a second concurrent uploadAll()
 *   call (e.g. auto-sync + manual button race) to pick up the SAME entry and POST
 *   it twice → duplicate rows in Google Sheets.
 *   resetStuckUploading() (called on every page load) resets any genuinely orphaned
 *   'uploading' entries (from app crash / navigation away) back to 'pending'.
 *
 * @returns {Promise<Array<number>>}
 */
async function getPendingSubmissionIds() {
    const db = await openDB();
    // IMPORTANT: Only return 'pending' entries.
    // Do NOT include 'uploading' — they are already being processed by the active session.
    const pendingKeys = await db.getAllKeysFromIndex(STORE_NAME, 'status', 'pending');
    return pendingKeys;
}

/**
 * Get a single submission by ID.
 * @param {number} id
 * @returns {Promise<Object|undefined>}
 */
async function getSubmission(id) {
    const db = await openDB();
    return db.get(STORE_NAME, id);
}

/**
 * Update the status of a submission.
 * @param {number} id
 * @param {string} status - 'pending' | 'uploading' | 'uploaded' | 'confirmed' | 'failed'
 * @param {string|null} error - Error message if failed
 */
async function updateSubmissionStatus(id, status, error) {
    const db = await openDB();
    const record = await db.get(STORE_NAME, id);
    if (!record) return;

    record.status = status;
    if (status === 'uploading') {
        record.uploadStartedAt = Date.now();
    }
    if (status === 'uploaded' || status === 'confirmed') {
        record.uploadedAt = new Date();
    }
    if (error !== undefined) {
        record.error = error;
    }
    try {
        await db.put(STORE_NAME, record);
    } catch (e) {
        console.warn('Ignored IDB put error in updateSubmissionStatus:', e.message);
    }
}

/**
 * Delete a single submission by ID.
 * @param {number} id
 */
async function deleteSubmission(id) {
    const db = await openDB();
    await db.delete(STORE_NAME, id);
}

/**
 * Delete all submissions with status "confirmed".
 * Does NOT delete "uploaded" (which are assumed unverified).
 * @returns {Promise<number>} Number of entries cleared
 */
async function clearConfirmed() {
    const db = await openDB();
    const toClearKeys = await db.getAllKeysFromIndex(STORE_NAME, 'status', 'confirmed');

    if (toClearKeys.length === 0) return 0;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    for (const key of toClearKeys) {
        tx.store.delete(key);
    }
    await tx.done;
    return toClearKeys.length;
}

/**
 * Get count of pending submissions (for badge display).
 * Includes "pending" and "failed" statuses.
 * @returns {Promise<number>}
 */
async function getPendingCount() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.store;
    const index = store.index('status');
    const pending = await index.count('pending');
    const failed = await index.count('failed');
    return pending + failed;
}

/**
 * Get counts by status (for queue page stats).
 * @returns {Promise<{total: number, pending: number, uploading: number, uploaded: number, confirmed: number, failed: number}>}
 */
async function getStatusCounts() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.store;
    const index = store.index('status');

    return {
        total: await store.count(),
        pending: await index.count('pending'),
        uploading: await index.count('uploading'),
        uploaded: await index.count('uploaded'),
        confirmed: await index.count('confirmed'),
        failed: await index.count('failed')
    };
}

/**
 * Estimate total storage used by the database (approximate).
 * @returns {Promise<{usedMB: number, quotaMB: number, percentUsed: number}>}
 */
async function getStorageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        return {
            usedMB: Math.round((est.usage || 0) / 1048576 * 10) / 10,
            quotaMB: Math.round((est.quota || 0) / 1048576),
            percentUsed: est.quota ? Math.round((est.usage / est.quota) * 100 * 10) / 10 : 0
        };
    }
    // Fallback: rough estimate based on record count
    const db = await openDB();
    const count = await db.count(STORE_NAME);
    return {
        usedMB: Math.round(count * 2 * 10) / 10, // ~2MB per record estimate
        quotaMB: 0,
        percentUsed: 0
    };
}

/**
 * Reset a failed submission back to pending for retry.
 * @param {number} id
 */
async function retrySubmission(id) {
    await updateSubmissionStatus(id, 'pending', null);
}

/**
 * Reset ALL failed submissions back to pending.
 * @returns {Promise<number>} Number of entries reset
 */
async function retryAllFailed() {
    const db = await openDB();
    const failed = await db.getAllFromIndex(STORE_NAME, 'status', 'failed');

    if (failed.length === 0) return 0;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    for (const record of failed) {
        record.status = 'pending';
        record.error = null;
        tx.store.put(record);
    }
    await tx.done;
    return failed.length;
}

/**
 * Reset any entries stuck in "uploading" status back to "pending".
 * This happens when a page is navigated away during an upload.
 * Should be called on page load.
 * @param {boolean} force - If true, resets ALL "uploading" entries regardless of timestamp.
 * @returns {Promise<number>} Number of entries reset
 */
async function resetStuckUploading(force = false) {
    const db = await openDB();
    const stuck = await db.getAllFromIndex(STORE_NAME, 'status', 'uploading');

    if (stuck.length === 0) return 0;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    let resetCount = 0;
    const STUCK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

    for (const record of stuck) {
        // If force is true, or there's no timestamp, or it's older than 2 minutes, it's genuinely stuck
        if (force || !record.uploadStartedAt || (Date.now() - record.uploadStartedAt) > STUCK_TIMEOUT_MS) {
            record.status = 'pending';
            record.error = null;
            tx.store.put(record);
            resetCount++;
        }
    }

    try {
        await tx.done;
        if (resetCount > 0) {
            console.log('[DB] Reset ' + resetCount + ' stuck uploading entries to pending');
        }
    } catch (e) {
        console.warn('[DB] Failed to reset stuck uploading entries:', e.message);
    }

    return resetCount;
}

// migrateBlobsToBase64 function removed as all entries are now base64.

// ─────────────────────────────────────────────
// KPI Tracking Module
// ─────────────────────────────────────────────

/**
 * Initialize KPI Tracker.
 * Checks if the configured ACTIVE_PERIOD.id matches the local storage.
 * If not, it wipes uploaded/confirmed entries and resets counters.
 */
async function initKPI() {
    if (typeof ACTIVE_PERIOD === 'undefined') return;

    const periodId = ACTIVE_PERIOD.id;

    // Guard: "none" is the placeholder used when no zone is selected (landing page).
    // Never treat it as a real period — it would mismatch the stored period and
    // trigger a destructive KPI reset + entry wipe on every bare index.html visit.
    if (!periodId || periodId === 'none') return;

    let stored = localStorage.getItem('kpi_period_id');

    if (stored !== periodId) {
        console.log('[KPI] New period detected. Resetting KPI counters and clearing uploaded/confirmed entries.');

        // Reset KPIs
        localStorage.setItem('kpi_period_id', periodId);
        
        // Carry over any unsent entries into the new period's "Recorded" count
        // so the UI stays consistent with the list of entries visible on the device.
        const carryOverCount = await getPendingCount();
        localStorage.setItem('kpi_total_recorded', carryOverCount.toString());
        localStorage.setItem('kpi_total_uploaded', '0');
        localStorage.setItem('kpi_total_time_ms', '0');
        localStorage.setItem('kpi_time_entries_count', '0');

        // Wipe uploaded and confirmed entries from IDB
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');

            const uploadedKeys = await tx.store.index('status').getAllKeys('uploaded');
            const confirmedKeys = await tx.store.index('status').getAllKeys('confirmed');
            const allKeys = [...uploadedKeys, ...confirmedKeys];

            for (const key of allKeys) {
                tx.store.delete(key);
            }
            await tx.done;
            console.log('[KPI] Cleared ' + allKeys.length + ' old entries from the previous period.');
        } catch (e) {
            console.warn('[KPI] Failed to clear old entries:', e);
        }

        // Refresh UI if functions are available
        if (typeof updateStats === 'function') updateStats();
        if (typeof refreshList === 'function') refreshList();
    }
}


/** Called in app.js when form opens/resets */
function trackFormStart() {
    try {
        sessionStorage.setItem('form_start_ms', Date.now().toString());
    } catch (e) { }
}

/** Called in app.js when form is saved to IDB */
function trackFormSaved() {
    try {
        let current = parseInt(localStorage.getItem('kpi_total_recorded') || '0', 10);
        localStorage.setItem('kpi_total_recorded', (current + 1).toString());

        let startMs = sessionStorage.getItem('form_start_ms');
        if (startMs) {
            let diff = Date.now() - parseInt(startMs, 10);
            // Only count if diff is reasonable (between 5 seconds and 1 hour)
            if (diff > 5000 && diff < 3600000) {
                let totalTime = parseInt(localStorage.getItem('kpi_total_time_ms') || '0', 10);
                let count = parseInt(localStorage.getItem('kpi_time_entries_count') || '0', 10);
                localStorage.setItem('kpi_total_time_ms', (totalTime + diff).toString());
                localStorage.setItem('kpi_time_entries_count', (count + 1).toString());
            }
        }
    } catch (e) { }
}

// Session-level set of UUIDs already counted as "uploaded" in KPI.
// Prevents retried entries from inflating the uploaded count.
const _kpiCountedUuids = new Set();

    /** Called in uploader.js when an entry is successfully POSTed.
     * @param {string} [uuid] - The UUID of the uploaded entry (for deduplication).
     */
    function trackEntryUploaded(uuid) {
        // If a UUID is provided and we've already counted it this session, skip.
        if (uuid) {
            if (_kpiCountedUuids.has(uuid)) {
                console.log('[KPI] Skipping duplicate upload count for UUID:', uuid);
                return;
            }
            _kpiCountedUuids.add(uuid);
        }
        let current = parseInt(localStorage.getItem('kpi_total_uploaded') || '0', 10);
        localStorage.setItem('kpi_total_uploaded', (current + 1).toString());
    }

    /** Get structured KPI data for the UI */
    function getKPIStats() {
        const total_time_ms = parseInt(localStorage.getItem('kpi_total_time_ms') || '0', 10);
        const count = parseInt(localStorage.getItem('kpi_time_entries_count') || '0', 10);

        let avg_time_sec = 0;
        if (count > 0) {
            avg_time_sec = Math.round((total_time_ms / count) / 1000);
        }

        let avg_time_str = '0s';
        if (avg_time_sec > 0) {
            let m = Math.floor(avg_time_sec / 60);
            let s = avg_time_sec % 60;
            avg_time_str = m > 0 ? m + 'm ' + s + 's' : s + 's';
        }

        return {
            recorded: parseInt(localStorage.getItem('kpi_total_recorded') || '0', 10),
            uploaded: parseInt(localStorage.getItem('kpi_total_uploaded') || '0', 10),
            avgTime: avg_time_str,
            periodName: typeof ACTIVE_PERIOD !== 'undefined' ? ACTIVE_PERIOD.name : 'Unknown'
        };
    }
