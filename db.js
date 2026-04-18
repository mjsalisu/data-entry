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
    if (!dataUrl || !dataUrl.startsWith('data:')) return null;
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const byteString = atob(parts[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mime });
}

/**
 * Convert a Blob back to a base64 data URL (needed at upload time).
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        if (!blob) { resolve(''); return; }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
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
 * Get all submissions with status "pending" or "failed".
 * @returns {Promise<Array>}
 */
async function getPendingSubmissions() {
    const db = await openDB();
    const all = await db.getAllFromIndex(STORE_NAME, 'status');
    return all.filter(r => r.status === 'pending' || r.status === 'failed');
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
    await db.put(STORE_NAME, record);
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
 * @returns {Promise<number>} Number of entries cleared
 */
async function clearConfirmed() {
    const db = await openDB();
    const all = await db.getAll(STORE_NAME);
    const confirmed = all.filter(r => r.status === 'confirmed');
    const tx = db.transaction(STORE_NAME, 'readwrite');
    for (const record of confirmed) {
        tx.store.delete(record.id);
    }
    await tx.done;
    return confirmed.length;
}

/**
 * Get count of pending submissions (for badge display).
 * Includes "pending" and "failed" statuses.
 * @returns {Promise<number>}
 */
async function getPendingCount() {
    const db = await openDB();
    const all = await db.getAll(STORE_NAME);
    return all.filter(r => r.status === 'pending' || r.status === 'failed').length;
}

/**
 * Get counts by status (for queue page stats).
 * @returns {Promise<{total: number, pending: number, uploading: number, uploaded: number, confirmed: number, failed: number}>}
 */
async function getStatusCounts() {
    const db = await openDB();
    const all = await db.getAll(STORE_NAME);
    return {
        total: all.length,
        pending: all.filter(r => r.status === 'pending').length,
        uploading: all.filter(r => r.status === 'uploading').length,
        uploaded: all.filter(r => r.status === 'uploaded').length,
        confirmed: all.filter(r => r.status === 'confirmed').length,
        failed: all.filter(r => r.status === 'failed').length
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
    const all = await db.getAll(STORE_NAME);
    const failed = all.filter(r => r.status === 'failed');
    const tx = db.transaction(STORE_NAME, 'readwrite');
    for (const record of failed) {
        record.status = 'pending';
        record.error = null;
        tx.store.put(record);
    }
    await tx.done;
    return failed.length;
}
