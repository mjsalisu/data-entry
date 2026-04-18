/**
 * queue.js — Upload Queue Page Logic
 *
 * Manages the submission list UI, upload controls, progress tracking,
 * and communicates with the uploader via BroadcastChannel.
 */

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let _allEntries = [];
let _currentFilter = 'all';
let _modalResolve = null;

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    // Update network status
    updateNetworkStatus();
    window.addEventListener('online', () => { updateNetworkStatus(); refreshList(); });
    window.addEventListener('offline', updateNetworkStatus);

    // Listen for broadcast messages from uploader
    onBroadcastMessage(handleBroadcast);

    // Initial load
    await refreshList();
    await updateStorageMeter();
});

// ─────────────────────────────────────────────
// List Rendering
// ─────────────────────────────────────────────

/**
 * Refresh the entire submission list from IndexedDB.
 */
async function refreshList() {
    _allEntries = await getAllSubmissions();
    await updateStats();
    renderList();
    updateControlsVisibility();
    updateTabBadge();
}

/**
 * Render the submission list with current filter.
 * Uses basic DOM rendering (efficient for up to ~500 entries).
 */
function renderList() {
    const container = document.getElementById('submissionList');
    const emptyState = document.getElementById('emptyState');

    // Filter entries
    let filtered = _allEntries;
    if (_currentFilter !== 'all') {
        if (_currentFilter === 'confirmed') {
            filtered = _allEntries.filter(e => e.status === 'confirmed' || e.status === 'uploaded');
        } else {
            filtered = _allEntries.filter(e => e.status === _currentFilter);
        }
    }

    // Clear existing items (keep empty state)
    const existing = container.querySelectorAll('.submission-item, .date-group-header');
    existing.forEach(el => el.remove());

    if (filtered.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    // Group by date
    const groups = {};
    filtered.forEach(entry => {
        const dateKey = formatDateGroup(entry.createdAt);
        if (!groups[dateKey]) groups[dateKey] = [];
        groups[dateKey].push(entry);
    });

    // Render groups
    const fragment = document.createDocumentFragment();

    Object.entries(groups).forEach(([dateLabel, entries]) => {
        // Date header
        const header = document.createElement('div');
        header.className = 'date-group-header';
        header.textContent = dateLabel + ' (' + entries.length + ')';
        fragment.appendChild(header);

        // Entries
        entries.forEach(entry => {
            fragment.appendChild(createEntryElement(entry));
        });
    });

    container.insertBefore(fragment, emptyState);
}

/**
 * Create a DOM element for a single submission entry.
 * @param {Object} entry
 * @returns {HTMLElement}
 */
function createEntryElement(entry) {
    const item = document.createElement('div');
    item.className = 'submission-item' + (entry.status === 'uploading' ? ' uploading-anim' : '');
    item.setAttribute('data-id', entry.id);
    item.onclick = () => showDetail(entry.id);

    const statusIcons = {
        pending: '⏳',
        uploading: '⬆️',
        uploaded: '☁️',
        confirmed: '✅',
        failed: '❌',
        waiting: '🕒'
    };

    const name = entry.payload.name || 'Unknown';
    const state = entry.payload.state || '';
    const certId = entry.payload.certificate_id || '';
    const time = formatTime(entry.createdAt);

    let metaText = state;
    if (certId) metaText += ' · ' + certId;
    metaText += ' · ' + time;

    item.innerHTML =
        '<div class="sub-status-icon ' + entry.status + '">' + (statusIcons[entry.status] || '❓') + '</div>' +
        '<div class="sub-info">' +
        '  <div class="sub-name">' + escapeHtml(name) + '</div>' +
        '  <div class="sub-meta">' + escapeHtml(metaText) + '</div>' +
        (entry.error ? '<div class="sub-error">' + escapeHtml(entry.error) + '</div>' : '') +
        '</div>';

    // Action button
    if (entry.status === 'failed') {
        const btn = document.createElement('button');
        btn.className = 'sub-action retry';
        btn.textContent = 'Retry';
        btn.onclick = async (e) => {
            e.stopPropagation();
            await retrySubmission(entry.id);
            await uploadSingle(entry.id);
            await refreshList();
        };
        item.appendChild(btn);
    }

    return item;
}

// ─────────────────────────────────────────────
// Stats & Controls
// ─────────────────────────────────────────────

/**
 * Update the stats cards from IndexedDB.
 */
async function updateStats() {
    const counts = await getStatusCounts();

    document.getElementById('statTotal').textContent = counts.total;
    document.getElementById('statPending').textContent = counts.pending;
    document.getElementById('statConfirmed').textContent = counts.confirmed + counts.uploaded;
    document.getElementById('statFailed').textContent = counts.failed;

    // Update upload button count
    const btnCount = document.getElementById('uploadBtnCount');
    if (btnCount) {
        btnCount.textContent = counts.pending > 0 ? counts.pending : '';
    }
}

/**
 * Update visibility of controls based on current state.
 */
function updateControlsVisibility() {
    const counts = {
        pending: _allEntries.filter(e => e.status === 'pending').length,
        failed: _allEntries.filter(e => e.status === 'failed').length,
        confirmed: _allEntries.filter(e => e.status === 'confirmed' || e.status === 'uploaded').length
    };

    const uploadBtn = document.getElementById('uploadAllBtn');
    const retryBtn = document.getElementById('retryAllBtn');
    const cleanupSection = document.getElementById('cleanupSection');

    // Upload button
    if (uploadBtn) {
        uploadBtn.disabled = counts.pending === 0 && counts.failed === 0;
        if (isUploading()) {
            uploadBtn.disabled = true;
            uploadBtn.querySelector('.btn-text').textContent = 'Uploading...';
        } else {
            uploadBtn.querySelector('.btn-text').textContent = 'Upload All';
        }
    }

    // Retry button
    if (retryBtn) {
        retryBtn.style.display = counts.failed > 0 ? 'block' : 'none';
    }

    // Cleanup section
    if (cleanupSection) {
        cleanupSection.style.display = counts.confirmed > 0 ? 'block' : 'none';
    }
}

/**
 * Update the storage meter.
 */
async function updateStorageMeter() {
    const est = await getStorageEstimate();
    const valueEl = document.getElementById('storageValue');
    const fillEl = document.getElementById('storageBarFill');

    if (valueEl) {
        if (est.quotaMB > 0) {
            valueEl.textContent = est.usedMB + ' MB / ' + est.quotaMB + ' MB';
        } else {
            valueEl.textContent = est.usedMB + ' MB used';
        }
    }

    if (fillEl) {
        const pct = Math.min(est.percentUsed, 100);
        fillEl.style.width = pct + '%';
        fillEl.className = 'storage-bar-fill';
        if (pct > 80) fillEl.classList.add('danger');
        else if (pct > 60) fillEl.classList.add('warning');
    }
}

// ─────────────────────────────────────────────
// Network Status
// ─────────────────────────────────────────────

function updateNetworkStatus() {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    const online = navigator.onLine;

    if (dot) {
        dot.className = 'status-dot ' + (online ? 'online' : 'offline');
    }
    if (text) {
        text.textContent = online ? 'Online' : 'Offline';
    }
}

// ─────────────────────────────────────────────
// Upload Handlers
// ─────────────────────────────────────────────

async function handleUploadAll() {
    if (!navigator.onLine) {
        alert('You are currently offline. Please connect to the internet to upload.');
        return;
    }

    const uploadBtn = document.getElementById('uploadAllBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const progressContainer = document.getElementById('progressContainer');

    uploadBtn.disabled = true;
    uploadBtn.querySelector('.btn-text').textContent = 'Uploading...';
    pauseBtn.style.display = 'block';
    progressContainer.style.display = 'block';

    const result = await uploadAll();

    // Reset UI
    uploadBtn.disabled = false;
    uploadBtn.querySelector('.btn-text').textContent = 'Upload All';
    pauseBtn.style.display = 'none';
    progressContainer.style.display = 'none';

    if (result) {
        await refreshList();
        await updateStorageMeter();

        if (result.failed === 0 && result.uploaded > 0) {
            showNotification('✅ All ' + result.uploaded + ' entries uploaded successfully!');
        } else if (result.failed > 0) {
            showNotification('⚠️ ' + result.uploaded + ' uploaded, ' + result.failed + ' failed. Tap "Retry Failed" to try again.');
        } else {
            showNotification('No pending entries to upload.');
        }
    }
}

function handlePause() {
    pauseUpload();
    const pauseBtn = document.getElementById('pauseBtn');
    pauseBtn.textContent = '⏸ Paused';
    pauseBtn.disabled = true;
}

async function handleRetryAll() {
    const count = await retryAllFailed();
    if (count > 0) {
        showNotification('🔄 Reset ' + count + ' failed entries. Tap "Upload All" to retry.');
        await refreshList();
    }
}

async function handleClearConfirmed() {
    const counts = await getStatusCounts();
    const total = counts.confirmed + counts.uploaded;

    if (total === 0) return;

    const confirmed = await showModal(
        'Clear Confirmed Entries',
        'Are you sure you want to permanently remove ' + total + ' confirmed entries from local storage?\n\nThis data is already in Google Sheets and cannot be recovered locally.'
    );

    if (confirmed) {
        const cleared = await clearConfirmed();
        showNotification('🗑️ Cleared ' + cleared + ' entries');
        await refreshList();
        await updateStorageMeter();
    }
}

// ─────────────────────────────────────────────
// Filter
// ─────────────────────────────────────────────

function filterList(filter, tabEl) {
    _currentFilter = filter;

    // Update active tab
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    if (tabEl) tabEl.classList.add('active');

    renderList();
}

// ─────────────────────────────────────────────
// Detail Panel
// ─────────────────────────────────────────────

async function showDetail(id) {
    const entry = await getSubmission(id);
    if (!entry) return;

    const overlay = document.getElementById('detailOverlay');
    const body = document.getElementById('detailBody');
    const actions = document.getElementById('detailActions');
    const title = document.getElementById('detailTitle');

    title.textContent = entry.payload.name || 'Entry Details';

    // Build fields
    const fields = [
        { label: 'Status', value: getStatusLabel(entry.status) },
        { label: 'UUID', value: entry.uuid },
        { label: 'Saved At', value: formatDateTime(entry.createdAt) },
        { label: 'State', value: entry.payload.state || 'N/A' },
        { label: 'Certificate ID', value: entry.payload.certificate_id || 'N/A' },
        { label: 'Email', value: entry.payload.email || 'N/A' },
        { label: 'Phone', value: entry.payload.phone || 'N/A' },
        { label: 'Training Details', value: entry.payload.training_details || 'N/A' },
        { label: 'Post-Test Score', value: entry.payload.post_test_score || 'N/A' }
    ];

    if (entry.uploadedAt) {
        fields.push({ label: 'Uploaded At', value: formatDateTime(entry.uploadedAt) });
    }
    if (entry.error) {
        fields.push({ label: 'Error', value: entry.error });
    }

    let html = '';
    fields.forEach(f => {
        html += '<div class="detail-field">' +
            '<div class="detail-field-label">' + escapeHtml(f.label) + '</div>' +
            '<div class="detail-field-value">' + escapeHtml(f.value) + '</div>' +
            '</div>';
    });

    // Image previews (create from Blobs)
    if (entry.pretestBlob) {
        const preUrl = URL.createObjectURL(entry.pretestBlob);
        html += '<div class="detail-field">' +
            '<div class="detail-field-label">PreTest Snapshot</div>' +
            '<img class="detail-image" src="' + preUrl + '" alt="PreTest">' +
            '</div>';
    }
    if (entry.posttestBlob) {
        const postUrl = URL.createObjectURL(entry.posttestBlob);
        html += '<div class="detail-field">' +
            '<div class="detail-field-label">PostTest Snapshot</div>' +
            '<img class="detail-image" src="' + postUrl + '" alt="PostTest">' +
            '</div>';
    }

    body.innerHTML = html;

    // Actions
    let actionsHtml = '';
    if (entry.status === 'failed' || entry.status === 'pending') {
        actionsHtml += '<button class="detail-btn detail-btn-retry" onclick="handleDetailRetry(' + entry.id + ')">🔄 Retry Upload</button>';
    }
    actionsHtml += '<button class="detail-btn detail-btn-delete" onclick="handleDetailDelete(' + entry.id + ')">🗑️ Delete</button>';
    actions.innerHTML = actionsHtml;

    overlay.style.display = 'block';
}

function closeDetail(event) {
    if (event && event.target !== document.getElementById('detailOverlay')) return;
    document.getElementById('detailOverlay').style.display = 'none';
}

async function handleDetailRetry(id) {
    closeDetail();
    await retrySubmission(id);
    await uploadSingle(id);
    await refreshList();
}

async function handleDetailDelete(id) {
    const confirmed = await showModal(
        'Delete Entry',
        'Are you sure you want to permanently delete this entry? This cannot be undone.'
    );

    if (confirmed) {
        closeDetail();
        await deleteSubmission(id);
        showNotification('Entry deleted');
        await refreshList();
        await updateStorageMeter();
    }
}

// ─────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────

function showModal(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalMessage').textContent = message;
        modal.style.display = 'flex';

        _modalResolve = resolve;

        const confirmBtn = document.getElementById('modalConfirm');
        // Clone to remove old listeners
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
        newBtn.id = 'modalConfirm';

        newBtn.onclick = () => {
            modal.style.display = 'none';
            resolve(true);
        };
    });
}

function closeModal() {
    document.getElementById('confirmModal').style.display = 'none';
    if (_modalResolve) {
        _modalResolve(false);
        _modalResolve = null;
    }
}

// ─────────────────────────────────────────────
// Notification (top toast)
// ─────────────────────────────────────────────

function showNotification(text) {
    // Remove existing
    const existing = document.querySelector('.queue-notification');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'queue-notification';
    el.textContent = text;
    el.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);' +
        'background:#1a1f3d;color:#e0e6f1;border:1px solid rgba(255,255,255,0.15);' +
        'padding:12px 20px;border-radius:12px;font-size:0.88rem;font-weight:500;' +
        'z-index:300;box-shadow:0 8px 30px rgba(0,0,0,0.4);text-align:center;max-width:90%;' +
        'animation:slide-down 0.3s ease-out;';
    document.body.appendChild(el);

    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(-10px)';
        el.style.transition = 'all 0.3s';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// ─────────────────────────────────────────────
// BroadcastChannel Handler
// ─────────────────────────────────────────────

function handleBroadcast(msg) {
    switch (msg.type) {
        case 'upload_progress':
            updateProgress(msg);
            updateEntryInList(msg.entryId, msg.status);
            break;
        case 'upload_waiting':
            updateWaitingProgress(msg);
            break;
        case 'upload_complete':
            refreshList();
            updateStorageMeter();
            updateTabBadge();
            break;
        case 'upload_paused':
            refreshList();
            break;
        case 'entry_updated':
            refreshList();
            updateTabBadge();
            break;
        case 'entry_saved':
            refreshList();
            updateStorageMeter();
            updateTabBadge();
            break;
    }
}

/**
 * Update the progress bar during upload.
 */
function updateProgress(msg) {
    const container = document.getElementById('progressContainer');
    const text = document.getElementById('progressText');
    const count = document.getElementById('progressCount');
    const fill = document.getElementById('progressBarFill');
    const current = document.getElementById('progressCurrent');

    if (container) container.style.display = 'block';

    if (msg.status === 'waiting') {
        if (text) text.textContent = '🕒 Server busy — auto-retrying...';
        if (current) current.textContent = '⏳ Waiting ' + (msg.waitSeconds || '') + 's before retry...';
    } else {
        if (text) text.textContent = 'Uploading...';
        if (count) count.textContent = msg.current + '/' + msg.total;
        if (fill) fill.style.width = Math.round((msg.current / msg.total) * 100) + '%';
        if (current) {
            const icon = msg.status === 'confirmed' ? '✅' : msg.status === 'failed' ? '❌' : '⬆️';
            current.textContent = icon + ' ' + (msg.entryName || 'Entry');
        }
    }
}

/**
 * Update the progress bar during a waiting/cooldown period.
 * Shows a live countdown: "Server busy — retrying in 12s..."
 */
function updateWaitingProgress(msg) {
    const container = document.getElementById('progressContainer');
    const text = document.getElementById('progressText');
    const count = document.getElementById('progressCount');
    const current = document.getElementById('progressCurrent');

    if (container) container.style.display = 'block';
    if (text) text.textContent = '🕒 ' + (msg.reason || 'Server busy');
    if (count) count.textContent = msg.current + '/' + msg.total;
    if (current) current.textContent = '⏳ Retrying in ' + msg.waitSeconds + 's...';
}

/**
 * Update the tab badge count.
 */
async function updateTabBadge() {
    try {
        const count = await getPendingCount();
        const badgeEl = document.getElementById('queueBadgeCount');
        if (badgeEl) {
            badgeEl.textContent = count;
            badgeEl.style.display = count > 0 ? 'inline-flex' : 'none';
        }
    } catch (e) { /* ignore */ }
}

/**
 * Update a single entry's status in the list without full re-render.
 */
function updateEntryInList(entryId, status) {
    const item = document.querySelector('.submission-item[data-id="' + entryId + '"]');
    if (!item) return;

    const statusIcons = { pending: '⏳', uploading: '⬆️', uploaded: '☁️', confirmed: '✅', failed: '❌', waiting: '🕒' };
    const iconEl = item.querySelector('.sub-status-icon');
    if (iconEl) {
        iconEl.className = 'sub-status-icon ' + status;
        iconEl.textContent = statusIcons[status] || '❓';
    }

    item.className = 'submission-item' + (status === 'uploading' ? ' uploading-anim' : '');

    // Update stats
    updateStats();
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDateGroup(date) {
    if (!(date instanceof Date)) date = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString('en-NG', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(date) {
    if (!(date instanceof Date)) date = new Date(date);
    return date.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(date) {
    if (!(date instanceof Date)) date = new Date(date);
    return date.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' ' + date.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

function getStatusLabel(status) {
    const labels = {
        pending: '⏳ Pending',
        uploading: '⬆️ Uploading',
        uploaded: '☁️ Uploaded (awaiting verification)',
        confirmed: '✅ Confirmed',
        failed: '❌ Failed',
        waiting: '🕒 Waiting to retry'
    };
    return labels[status] || status;
}
