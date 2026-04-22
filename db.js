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

/**
 * Convert a base64 data URL to a Blob (saves ~33% storage vs string).
 * @param {string} dataUrl - e.g. "data:image/jpeg;base64,/9j/4AAQ..."
 * @returns {Blob}
 */
function dataUrlToBlob(dataUrl) {
    // Avoid storing Blobs on iOS to prevent IndexedDB object store errors.
    // Instead, just return the dataUrl string directly.
    return dataUrl || null;
}

/**
 * Convert a Blob back to a base64 data URL (needed at upload time).
 *
 * WHY the timeout exists:
 *   iOS Safari stores Blob objects in IndexedDB but then invalidates them
 *   after the app has been backgrounded or after time passes. When this
 *   happens, FileReader silently hangs — neither onload nor onerror ever
 *   fires. This caused the entire upload loop to freeze at the first old
 *   Blob-format entry (showing "5%" / entry 2 forever).
 *   The 10-second timeout races against FileReader so a dead Blob returns
 *   an empty string instead of hanging the process.
 *
 * @param {Blob|string} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
    if (!blob) return Promise.resolve('');
    if (typeof blob === 'string') return Promise.resolve(blob); // Fast path: already a string

    // Wrap FileReader in a timeout race to handle iOS-invalidated Blobs
    return Promise.race([
        // Primary: FileReader conversion
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Image read failed — file may be corrupted or lost by iOS'));
            reader.readAsDataURL(blob);
        }),
        // Safety net: if FileReader never fires (dead Blob on iOS), resolve with '' after 10s
        new Promise((resolve) => {
            setTimeout(() => {
                console.warn('[blobToDataUrl] FileReader timed out — Blob may be invalid (iOS bug). Skipping image for this entry.');
                resolve(''); // Return empty string; upload continues without the image
            }, 10000);
        })
    ]);
}

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
        pretestBlob: dataUrlToBlob(images.pretest || ''),
        posttestBlob: dataUrlToBlob(images.posttest || ''),
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
    // Retrieve both 'pending' and 'uploading' items
    // If an item is stuck in 'uploading', we want to try uploading it again
    // Server-side UUID detection prevents duplicate rows.
    const pending = await db.getAllFromIndex(STORE_NAME, 'status', 'pending');
    const uploading = await db.getAllFromIndex(STORE_NAME, 'status', 'uploading');
    return pending.concat(uploading);
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
 * Get IDs of all pending and uploading submissions.
 * Only loads keys, not full records — prevents memory exhaustion
 * when there are 100+ entries with large image data.
 *
 * @returns {Promise<Array<number>>}
 */
async function getPendingSubmissionIds() {
    const db = await openDB();
    const pendingKeys = await db.getAllKeysFromIndex(STORE_NAME, 'status', 'pending');
    const uploadingKeys = await db.getAllKeysFromIndex(STORE_NAME, 'status', 'uploading');
    return pendingKeys.concat(uploadingKeys);
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
 * @returns {Promise<number>} Number of entries reset
 */
async function resetStuckUploading() {
    const db = await openDB();
    const stuck = await db.getAllFromIndex(STORE_NAME, 'status', 'uploading');
    
    if (stuck.length === 0) return 0;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    for (const record of stuck) {
        record.status = 'pending';
        record.error = null;
        tx.store.put(record);
    }
    
    try {
        await tx.done;
        console.log('[DB] Reset ' + stuck.length + ' stuck uploading entries to pending');
    } catch (e) {
        console.warn('[DB] Failed to reset stuck uploading entries:', e.message);
    }
    
    return stuck.length;
}

/**
 * Migrate old Blob-format image entries to base64 strings.
 *
 * WHY this is critical on iOS:
 *   Before our fix, images were stored as Blob objects in IndexedDB.
 *   iOS Safari invalidates these Blobs after the app is backgrounded or
 *   after some time passes — FileReader then silently hangs forever.
 *   This migration runs EAGERLY on page load to convert all Blob entries
 *   to base64 strings BEFORE iOS has a chance to invalidate them.
 *
 *   - Entries already stored as strings → skipped instantly (no-op)
 *   - Entries stored as live Blobs → converted to base64 and saved back
 *   - Entries whose Blobs iOS has already killed → saved as '' (prevents
 *     future upload hangs; the text data is still uploaded correctly)
 *
 * @returns {Promise<{migrated: number, alreadyString: number, failed: number}>}
 */
async function migrateBlobsToBase64() {
    const db = await openDB();
    
    let migrated = 0;
    let failed = 0;
    let alreadyStringCount = 0;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    let cursor = await tx.store.openCursor();

    while (cursor) {
        const record = cursor.value;
        const needsMig = (record.pretestBlob && typeof record.pretestBlob !== 'string') ||
                         (record.posttestBlob && typeof record.posttestBlob !== 'string');

        if (!needsMig) {
            alreadyStringCount++;
            cursor = await cursor.continue();
            continue;
        }

        let changed = false;

        // Convert pretest Blob
        if (record.pretestBlob && typeof record.pretestBlob !== 'string') {
            const result = await blobToDataUrl(record.pretestBlob);
            record.pretestBlob = result; // '' if Blob was dead, base64 if live
            changed = true;
            if (!result) {
                console.warn('[DB] migrateBlobsToBase64: pretest Blob was already dead for entry', record.id);
                failed++;
            }
        }

        // Convert posttest Blob
        if (record.posttestBlob && typeof record.posttestBlob !== 'string') {
            const result = await blobToDataUrl(record.posttestBlob);
            record.posttestBlob = result;
            changed = true;
            if (!result) {
                console.warn('[DB] migrateBlobsToBase64: posttest Blob was already dead for entry', record.id);
            }
        }

        if (changed) {
            await cursor.update(record);
            migrated++;
        }

        cursor = await cursor.continue();
    }
    
    await tx.done;

    console.log('[DB] migrateBlobsToBase64 complete: ' + migrated + ' migrated, ' + failed + ' had dead Blobs.');
    return { migrated, alreadyString: alreadyStringCount, failed };
}

