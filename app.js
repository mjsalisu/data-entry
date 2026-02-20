// app.js

// ─────────────────────────────────────────────
// Location Dropdown Helper
// ─────────────────────────────────────────────
function updateLocs() {
    const stateVal = document.getElementById('state').value;
    const locSelect = document.getElementById('location');
    locSelect.innerHTML = '<option value="">-- Select --</option>';
    if (LOCS[stateVal]) {
        LOCS[stateVal].forEach(loc => {
            const opt = document.createElement('option');
            opt.value = loc;
            opt.textContent = loc;
            locSelect.add(opt);
        });
    }
    // Re-validate location after state changes
    validateField(locSelect);
    saveDraft();
}

// ─────────────────────────────────────────────
// Real-time Field Validation
// ─────────────────────────────────────────────

/**
 * Validates a single form field and applies Bootstrap is-valid / is-invalid classes.
 * Also handles the custom Email+Phone combination check.
 * @param {HTMLElement} field - The input, select, or textarea element.
 */
function validateField(field) {
    if (!field || !field.name) return;

    const form = document.getElementById('dataForm');

    // Reset any prior custom validity
    field.setCustomValidity('');

    // ── Custom combo check for email + phone ──
    if (field.name === 'email' || field.name === 'phone') {
        const emailInput = form.elements['email'];
        const phoneInput = form.elements['phone'];
        if (emailInput && phoneInput) {
            // Reset both first so we don't cascade errors from previous state
            emailInput.setCustomValidity('');
            phoneInput.setCustomValidity('');
            if (emailInput.value === 'NA' && phoneInput.value === '0') {
                const msg = 'Cannot have both Email as "NA" and Phone as "0".';
                emailInput.setCustomValidity(msg);
                phoneInput.setCustomValidity(msg);
                applyValidClass(emailInput, false);
                applyValidClass(phoneInput, false);
                return;
            }
        }
    }

    // Skip validation for hidden fields or fields without constraints
    if (field.type === 'hidden' || field.type === 'submit') return;

    const valid = field.checkValidity();
    applyValidClass(field, valid);
}

/**
 * Applies Bootstrap is-valid / is-invalid class to an element.
 * Rules:
 *  - Optional empty field  → no colour
 *  - Required empty field  → red (is-invalid)
 *  - Field with content    → green or red depending on validity
 *  - Select on placeholder → no colour (value === '')
 * @param {HTMLElement} field
 * @param {boolean} valid
 */
function applyValidClass(field, valid) {
    if (field.type === 'radio' || field.type === 'checkbox') return;

    field.classList.remove('is-valid', 'is-invalid');

    // A select's placeholder option always has value=""
    const isSelectPlaceholder = field.tagName === 'SELECT' && field.value === '';
    const hasValue = !isSelectPlaceholder &&
        field.value !== null &&
        field.value.trim() !== '';

    if (hasValue) {
        // Has meaningful content — show colour based on validity
        field.classList.add(valid ? 'is-valid' : 'is-invalid');
    } else if (field.required) {
        // Required but empty — always red
        field.classList.add('is-invalid');
    }
    // Optional field that is empty or on placeholder: no colour shown
}

// ─────────────────────────────────────────────
// Session Draft — localStorage
// ─────────────────────────────────────────────
const DRAFT_KEY = 'jobberman_form_draft';
let saveTimer = null;

/**
 * Collects all named form field values and saves them to localStorage.
 * Debounced by 500ms to avoid excessive writes on fast typing.
 */
function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const form = document.getElementById('dataForm');
        if (!form) return;

        const draft = {};
        const formData = new FormData(form);

        // Get all checkboxes as array
        const checkboxMap = {};
        form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            if (!checkboxMap[cb.name]) checkboxMap[cb.name] = [];
            if (cb.checked) checkboxMap[cb.name].push(cb.value);
        });

        formData.forEach((v, k) => {
            // Avoid double-storing checkbox values already handled above
            if (!(k in checkboxMap)) draft[k] = v;
        });

        // Merge checkbox values
        Object.entries(checkboxMap).forEach(([k, vals]) => {
            draft[k] = vals;
        });

        // Store radio values manually because FormData only keeps one
        form.querySelectorAll('input[type="radio"]:checked').forEach(r => {
            draft[r.name] = r.value;
        });

        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }, 500);
}

/**
 * Restores form field values from a saved draft object.
 * @param {Object} draft
 */
function restoreDraft(draft) {
    const form = document.getElementById('dataForm');
    if (!form) return;

    Object.entries(draft).forEach(([name, value]) => {
        // Handle radio buttons
        const radios = form.querySelectorAll(`input[name="${name}"][type="radio"]`);
        if (radios.length > 0) {
            radios.forEach(r => { r.checked = (r.value === value); });
            return;
        }

        // Handle checkboxes
        const checkboxes = form.querySelectorAll(`input[name="${name}"][type="checkbox"]`);
        if (checkboxes.length > 0) {
            const vals = Array.isArray(value) ? value : (value ? value.split(', ') : []);
            checkboxes.forEach(cb => { cb.checked = vals.includes(cb.value); });
            return;
        }

        // Handle regular inputs, selects, textareas
        const field = form.elements[name];
        if (field && !field.length) {
            field.value = value || '';
        }
    });

    // Rebuild location dropdown FIRST (state must be set already above)
    const stateEl = form.elements['state'];
    if (stateEl && stateEl.value) {
        // Rebuild options
        const stateVal = stateEl.value;
        const locSelect = document.getElementById('location');
        if (locSelect && typeof LOCS !== 'undefined' && LOCS[stateVal]) {
            locSelect.innerHTML = '<option value="">-- Select --</option>';
            LOCS[stateVal].forEach(loc => {
                const opt = document.createElement('option');
                opt.value = loc;
                opt.textContent = loc;
                locSelect.add(opt);
            });
            // Now restore the saved location value
            if (draft['location']) locSelect.value = draft['location'];
        }
    }

    // Re-trigger conditional field logic
    toggleLevel();

    // Validate all restored fields after a short delay
    setTimeout(() => {
        form.querySelectorAll('input, select, textarea').forEach(field => {
            if (field.name) validateField(field);
        });
    }, 100);
}

// ─────────────────────────────────────────────
// Qualification → Current Level toggle
// ─────────────────────────────────────────────
function toggleLevel() {
    const qualSelect = document.getElementById('qualification');
    const levelGroup = document.getElementById('current_level_group');
    if (!qualSelect || !levelGroup) return;

    if (qualSelect.value === 'Undergraduate') {
        levelGroup.style.display = 'block';
        const levelSelect = levelGroup.querySelector('select');
        if (levelSelect) levelSelect.required = true;
    } else {
        levelGroup.style.display = 'none';
        const levelSelect = levelGroup.querySelector('select');
        if (levelSelect) {
            levelSelect.required = false;
            if (qualSelect.value !== '') levelSelect.value = '';
        }
    }
}

// ─────────────────────────────────────────────
// DOMContentLoaded — Wire everything up
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('dataForm');
    if (!form) return;

    // ── Qualification logic ──
    const qualSelect = document.getElementById('qualification');
    if (qualSelect) {
        qualSelect.addEventListener('change', () => { toggleLevel(); validateField(qualSelect); saveDraft(); });
        toggleLevel();
    }

    // ── Date of Birth auto-format on blur ──
    const dobInput = form.querySelector('input[name="dob"]');
    if (dobInput) {
        dobInput.addEventListener('blur', function () {
            let val = this.value.trim();
            if (!val) return;

            // Append year 1900 if no 4-digit year detected
            if (!/\d{4}$/.test(val)) val += ' 1900';

            const dateObj = new Date(val);
            if (!isNaN(dateObj.getTime())) {
                const day = dateObj.getDate();
                const month = dateObj.toLocaleString('default', { month: 'short' });
                const year = dateObj.getFullYear();
                this.value = `${day} ${month}, ${year}`;
            }
            validateField(this);
            saveDraft();
        });
    }

    // ── Attach real-time validation + draft save to ALL form fields ──
    form.querySelectorAll('input, select, textarea').forEach(field => {
        const events = (field.type === 'checkbox' || field.type === 'radio')
            ? ['change']
            : ['input', 'blur', 'change'];

        events.forEach(evt => {
            field.addEventListener(evt, () => {
                validateField(field);
                saveDraft();
            });
        });
    });

    // ── Draft Restore Banner Logic ──
    const draft = localStorage.getItem(DRAFT_KEY);
    const draftBanner = document.getElementById('draftBanner');

    if (draft && draftBanner) {
        try {
            const parsed = JSON.parse(draft);
            const hasContent = Object.values(parsed).some(v =>
                (Array.isArray(v) ? v.length > 0 : v && v.trim() !== '' && v !== '')
            );

            if (hasContent) {
                draftBanner.style.removeProperty('display');
                draftBanner.style.display = 'flex';

                document.getElementById('restoreDraftBtn').addEventListener('click', () => {
                    restoreDraft(parsed);
                    draftBanner.style.display = 'none';
                });

                document.getElementById('clearDraftBtn').addEventListener('click', () => {
                    localStorage.removeItem(DRAFT_KEY);
                    draftBanner.style.display = 'none';
                });
            }
        } catch (e) {
            // Corrupted draft — clear it
            localStorage.removeItem(DRAFT_KEY);
        }
    }

    // ── Form Submit Handler ──
    form.addEventListener('submit', function (event) {
        event.preventDefault();

        const emailInput = this.elements['email'];
        const phoneInput = this.elements['phone'];

        // Reset custom validity
        emailInput.setCustomValidity('');
        phoneInput.setCustomValidity('');

        // Custom combo check
        if (emailInput.value === 'NA' && phoneInput.value === '0') {
            const msg = 'Cannot have both Email as "NA" and Phone as "0".';
            emailInput.setCustomValidity(msg);
            phoneInput.setCustomValidity(msg);
        }

        // Run real-time validation on ALL fields before submitting
        this.querySelectorAll('input, select, textarea').forEach(field => {
            if (field.name) validateField(field);
        });

        // Check validity without adding was-validated class
        // (was-validated uses CSS :valid/:invalid which greens optional empty fields)
        if (!this.checkValidity()) {
            event.stopPropagation();

            // Scroll to first field we explicitly marked invalid
            const firstInvalid = this.querySelector('.is-invalid');
            if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // ── Submit ──
        const subBtn = document.getElementById('subBtn');
        const loader = document.getElementById('loader');

        subBtn.disabled = true;
        subBtn.innerHTML = '⏳ Submitting...';
        loader.style.display = 'block';

        const payload = {};
        const formData = new FormData(this);

        // Handle checkboxes as comma-separated
        const checkboxNames = new Set();
        this.querySelectorAll('input[type="checkbox"]').forEach(cb => checkboxNames.add(cb.name));

        checkboxNames.forEach(name => {
            const checked = [];
            this.querySelectorAll(`input[name="${name}"]:checked`).forEach(cb => checked.push(cb.value));
            payload[name] = checked.join(', ');
        });

        formData.forEach((v, k) => {
            if (!checkboxNames.has(k)) payload[k] = v;
        });

        console.log('Submitting payload:', payload);

        fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            mode: 'no-cors'
        })
            .then(() => {
                // Clear draft on successful submission
                localStorage.removeItem(DRAFT_KEY);
                alert('Registration Sent! Checking the sheet now...');
                location.reload();
            })
            .catch(err => {
                alert('Error: ' + err.message);
                subBtn.disabled = false;
                subBtn.innerHTML = 'Submit Registration';
                loader.style.display = 'none';
            });
    });
});
