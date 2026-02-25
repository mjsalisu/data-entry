// app.js

// ─────────────────────────────────────────────
// Global: Dynamic Fields data from DynamicFields sheet
// Structure: { "State": { "InputtedBy": ["Institution1", ...] } }
// ─────────────────────────────────────────────
let DYNAMIC_FIELDS = {};

// ─────────────────────────────────────────────
// Cascading Dropdown Logic
// ─────────────────────────────────────────────

/**
 * Populate the State dropdown from DYNAMIC_FIELDS keys.
 */
function populateStates() {
    const stateSelect = document.getElementById('state');
    if (!stateSelect) return;

    stateSelect.innerHTML = '<option value="">-- Select State --</option>';
    Object.keys(DYNAMIC_FIELDS).sort().forEach(state => {
        const opt = document.createElement('option');
        opt.value = state;
        opt.textContent = state;
        stateSelect.add(opt);
    });
}

/**
 * Called when State changes — populate "Inputted by" dropdown.
 */
function onStateChange() {
    const stateVal = document.getElementById('state').value;
    const inputtedBySelect = document.getElementById('inputted_by');
    const trainingSelect = document.getElementById('training_details');

    // Reset downstream
    inputtedBySelect.innerHTML = '<option value="">-- Select --</option>';
    trainingSelect.innerHTML = '<option value="">Select inputted by first</option>';

    if (stateVal && DYNAMIC_FIELDS[stateVal]) {
        const names = Object.keys(DYNAMIC_FIELDS[stateVal]).sort();
        names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            inputtedBySelect.add(opt);
        });
    }

    validateField(inputtedBySelect);
    validateField(trainingSelect);

    // Also update refreshment dropdowns (Biscuit & Drink)
    populateRefreshments(stateVal);
    saveDraft();
}

/**
 * Called when "Inputted by" changes — populate "Institution / Training Details".
 */
function onInputtedByChange() {
    const stateVal = document.getElementById('state').value;
    const inputtedByVal = document.getElementById('inputted_by').value;
    const trainingSelect = document.getElementById('training_details');

    trainingSelect.innerHTML = '<option value="">-- Select --</option>';

    if (stateVal && inputtedByVal &&
        DYNAMIC_FIELDS[stateVal] &&
        DYNAMIC_FIELDS[stateVal][inputtedByVal]) {
        const institutions = DYNAMIC_FIELDS[stateVal][inputtedByVal];
        institutions.forEach(inst => {
            const opt = document.createElement('option');
            opt.value = inst;
            opt.textContent = inst;
            trainingSelect.add(opt);
        });
    }

    validateField(trainingSelect);
    saveDraft();
}

/**
 * Populate Biscuit and Drink dropdowns based on State from REFRESHMENTS config.
 */
function populateRefreshments(stateVal) {
    const biscuitSelect = document.getElementById('ref_biscuit');
    const drinkSelect = document.getElementById('ref_drink');
    if (!biscuitSelect || !drinkSelect) return;

    // Reset both
    biscuitSelect.innerHTML = '<option value="">-- Select --</option>';
    drinkSelect.innerHTML = '<option value="">-- Select --</option>';

    if (stateVal && typeof REFRESHMENTS !== 'undefined' && REFRESHMENTS[stateVal]) {
        const stateData = REFRESHMENTS[stateVal];

        if (stateData.biscuit) {
            stateData.biscuit.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item;
                opt.textContent = item;
                biscuitSelect.add(opt);
            });
        }

        if (stateData.drink) {
            stateData.drink.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item;
                opt.textContent = item;
                drinkSelect.add(opt);
            });
        }
    } else {
        biscuitSelect.innerHTML = '<option value="">Select state first</option>';
        drinkSelect.innerHTML = '<option value="">Select state first</option>';
    }

    validateField(biscuitSelect);
    validateField(drinkSelect);
}

/**
 * Fetch dynamic fields from Google Apps Script and populate the State dropdown.
 */
async function loadDynamicFields() {
    const loader = document.getElementById('dynamicFieldsLoader');
    const stateSelect = document.getElementById('state');

    if (loader) loader.style.display = 'block';
    if (stateSelect) stateSelect.disabled = true;

    try {
        const resp = await fetch(SCRIPT_URL + '?action=getDynamicFields');
        DYNAMIC_FIELDS = await resp.json();
        populateStates();
    } catch (err) {
        console.error('Failed to load dynamic fields:', err);
        // Fall back — let the user type manually if fetch fails
        const stateEl = document.getElementById('state');
        if (stateEl) {
            stateEl.innerHTML = '<option value="">⚠ Failed to load — refresh page</option>';
        }
    } finally {
        if (loader) loader.style.display = 'none';
        if (stateSelect) stateSelect.disabled = false;
    }
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

    // ── Preferred language checkbox group — at least 1 required ──
    if (field.name === 'preferred_language' && field.type === 'checkbox') {
        const langBoxes = form.querySelectorAll('input[name="preferred_language"]');
        const anyChecked = Array.from(langBoxes).some(cb => cb.checked);
        const langMsg = document.getElementById('lang_validation_msg');
        // Apply visual style to all language checkboxes as a group
        langBoxes.forEach(cb => {
            cb.setCustomValidity(anyChecked ? '' : 'Please select at least one language.');
        });
        // Show/hide the visible error message
        if (langMsg) langMsg.style.display = anyChecked ? 'none' : 'block';
        return;
    }

    // ── Snapshot hidden inputs — show/hide validation message ──
    if (field.name === 'image_pretest' || field.name === 'image_posttest') {
        const key = field.name === 'image_pretest' ? 'pretest' : 'posttest';
        const msgEl = document.getElementById(key + '_validation_msg');
        if (msgEl) {
            msgEl.style.display = field.value ? 'none' : 'block';
        }
        return;
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
    if (field.type === 'checkbox') return;

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

        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }, 500);
}

/**
 * Restores form field values from a saved draft object.
 * Handles the cascading dropdowns by rebuilding them in sequence.
 * @param {Object} draft
 */
function restoreDraft(draft) {
    const form = document.getElementById('dataForm');
    if (!form) return;

    // First pass: restore all non-cascading fields
    Object.entries(draft).forEach(([name, value]) => {
        // Skip cascading fields — we'll handle them after
        if (['state', 'inputted_by', 'training_details', 'ref_biscuit', 'ref_drink'].includes(name)) return;

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

    // Second pass: rebuild cascading dropdowns
    if (draft['state']) {
        const stateEl = document.getElementById('state');
        if (stateEl) {
            stateEl.value = draft['state'];

            // Rebuild "Inputted by" options for this state
            const inputtedBySelect = document.getElementById('inputted_by');
            if (inputtedBySelect && DYNAMIC_FIELDS[draft['state']]) {
                inputtedBySelect.innerHTML = '<option value="">-- Select --</option>';
                Object.keys(DYNAMIC_FIELDS[draft['state']]).sort().forEach(name => {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    inputtedBySelect.add(opt);
                });

                if (draft['inputted_by']) {
                    inputtedBySelect.value = draft['inputted_by'];

                    // Rebuild "Training Details" options
                    const trainingSelect = document.getElementById('training_details');
                    if (trainingSelect &&
                        DYNAMIC_FIELDS[draft['state']][draft['inputted_by']]) {
                        trainingSelect.innerHTML = '<option value="">-- Select --</option>';
                        DYNAMIC_FIELDS[draft['state']][draft['inputted_by']].forEach(inst => {
                            const opt = document.createElement('option');
                            opt.value = inst;
                            opt.textContent = inst;
                            trainingSelect.add(opt);
                        });

                        if (draft['training_details']) {
                            trainingSelect.value = draft['training_details'];
                        }
                    }
                }
            }
        }
    }

    // Third pass: rebuild refreshment dropdowns from State
    if (draft['state']) {
        populateRefreshments(draft['state']);
        if (draft['ref_biscuit']) {
            const bs = document.getElementById('ref_biscuit');
            if (bs) bs.value = draft['ref_biscuit'];
        }
        if (draft['ref_drink']) {
            const ds = document.getElementById('ref_drink');
            if (ds) ds.value = draft['ref_drink'];
        }
    }

    // Re-trigger conditional field logic
    toggleLevel();
    toggleJobbermanNote();
    toggleDisability();
    toggleDisabilityOther();
    toggleLanguageOther();

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
// Jobberman SST → cross-check note toggle
// ─────────────────────────────────────────────
function toggleJobbermanNote() {
    const sstSelect = document.getElementById('jobberman_sst');
    const note = document.getElementById('jobberman_sst_note');
    if (!sstSelect || !note) return;
    note.style.display = sstSelect.value === 'Yes' ? 'block' : 'none';
}

// ─────────────────────────────────────────────
// Disability → Disability Type toggle
// ─────────────────────────────────────────────
function toggleDisability() {
    const disSelect = document.getElementById('disability');
    const typeGroup = document.getElementById('disability_type_group');
    const otherGroup = document.getElementById('disability_type_other_group');
    const typeSelect = document.getElementById('disability_type');
    const otherInput = document.getElementById('disability_type_other');
    if (!disSelect || !typeGroup) return;

    if (disSelect.value === 'Yes') {
        typeGroup.style.display = 'block';
        if (typeSelect) typeSelect.required = true;
    } else {
        typeGroup.style.display = 'none';
        if (otherGroup) otherGroup.style.display = 'none';
        if (typeSelect) { typeSelect.required = false; typeSelect.value = ''; }
        if (otherInput) { otherInput.required = false; otherInput.value = ''; }
    }
}

function toggleDisabilityOther() {
    const typeSelect = document.getElementById('disability_type');
    const otherGroup = document.getElementById('disability_type_other_group');
    const otherInput = document.getElementById('disability_type_other');
    if (!typeSelect || !otherGroup) return;

    if (typeSelect.value === 'Other') {
        otherGroup.style.display = 'block';
        if (otherInput) otherInput.required = true;
    } else {
        otherGroup.style.display = 'none';
        if (otherInput) { otherInput.required = false; otherInput.value = ''; }
    }
}

// ─────────────────────────────────────────────
// Language "Other" checkbox → text input toggle
// ─────────────────────────────────────────────
function toggleLanguageOther() {
    const otherCb = document.getElementById('langOther');
    const otherGroup = document.getElementById('lang_other_group');
    const otherInput = document.getElementById('lang_other_input');
    if (!otherCb || !otherGroup) return;

    if (otherCb.checked) {
        otherGroup.style.display = 'block';
        if (otherInput) otherInput.required = true;
    } else {
        otherGroup.style.display = 'none';
        if (otherInput) { otherInput.required = false; otherInput.value = ''; }
    }
}

// ─────────────────────────────────────────────
// DOMContentLoaded — Wire everything up
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('dataForm');
    if (!form) return;

    // ── Load dynamic data from DynamicFields sheet ──
    await loadDynamicFields();

    // ── Wire cascading dropdown events ──
    const stateSelect = document.getElementById('state');
    const inputtedBySelect = document.getElementById('inputted_by');
    const trainingSelect = document.getElementById('training_details');

    if (stateSelect) {
        stateSelect.addEventListener('change', () => {
            onStateChange();
            validateField(stateSelect);
        });
    }
    if (inputtedBySelect) {
        inputtedBySelect.addEventListener('change', () => {
            onInputtedByChange();
            validateField(inputtedBySelect);
        });
    }
    if (trainingSelect) {
        trainingSelect.addEventListener('change', () => {
            validateField(trainingSelect);
            saveDraft();
        });
    }

    // ── Qualification logic ──
    const qualSelect = document.getElementById('qualification');
    if (qualSelect) {
        qualSelect.addEventListener('change', () => { toggleLevel(); validateField(qualSelect); saveDraft(); });
        toggleLevel();
    }

    // ── Jobberman SST cross-check note ──
    const sstSelect = document.getElementById('jobberman_sst');
    if (sstSelect) {
        sstSelect.addEventListener('change', () => { toggleJobbermanNote(); validateField(sstSelect); saveDraft(); });
        toggleJobbermanNote();
    }

    // ── Disability toggle ──
    const disSelect = document.getElementById('disability');
    if (disSelect) {
        disSelect.addEventListener('change', () => { toggleDisability(); validateField(disSelect); saveDraft(); });
        toggleDisability();
    }
    const disTypeSelect = document.getElementById('disability_type');
    if (disTypeSelect) {
        disTypeSelect.addEventListener('change', () => { toggleDisabilityOther(); validateField(disTypeSelect); saveDraft(); });
        toggleDisabilityOther();
    }

    // ── Language "Other" checkbox toggle ──
    const langOtherCb = document.getElementById('langOther');
    if (langOtherCb) {
        langOtherCb.addEventListener('change', () => { toggleLanguageOther(); saveDraft(); });
        toggleLanguageOther();
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

        // ── Merge "Other" text inputs into parent fields ──
        // Disability type: if "Other" was selected, use the typed value
        if (payload.disability_type === 'Other' && payload.disability_type_other) {
            payload.disability_type = payload.disability_type_other;
        }
        delete payload.disability_type_other;

        // Preferred language: if "Other" was checked, replace it with the typed value
        if (payload.preferred_language && payload.preferred_language.includes('Other')) {
            const otherText = payload.preferred_language_other || 'Other';
            payload.preferred_language = payload.preferred_language
                .split(', ')
                .map(lang => lang === 'Other' ? otherText : lang)
                .join(', ');
        }
        delete payload.preferred_language_other;

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
