// app.js

// ─────────────────────────────────────────────
// Global: Dynamic Fields data from DynamicFields sheet
// Structure: { "State": { "InputtedBy": ["Institution1", ...] } }
// ─────────────────────────────────────────────
let DYNAMIC_FIELDS = {};

// ─────────────────────────────────────────────
// Upload Enforcement — Prevent Data Hoarding
//
// 3-layer system to pressure users into uploading:
//  Layer 1: Eager auto-upload (upload each entry immediately if online)
//  Layer 2: Nag banner (≥10 pending entries — persistent warning)
//  Layer 3: Friction gate (≥30 pending entries — 5s countdown overlay)
// ─────────────────────────────────────────────
const NAG_THRESHOLD = 10;   // Show persistent warning banner
const GATE_THRESHOLD = 30;  // Show friction gate overlay
let _gateCountdownTimer = null;

/**
 * Check pending count and show nag banner or friction gate as needed.
 * Called on page load, after each form save, and on "Enter Another Record".
 */
async function checkUploadEnforcement() {
    let pendingCount = 0;
    try {
        pendingCount = await getPendingCount();
    } catch (e) { return; }

    const nagBanner = document.getElementById('uploadNagBanner');
    const gateOverlay = document.getElementById('uploadGateOverlay');

    // Layer 3: Friction gate (≥30)
    if (pendingCount >= GATE_THRESHOLD) {
        if (nagBanner) nagBanner.style.display = 'block';
        const nagCount = document.getElementById('nagPendingCount');
        if (nagCount) nagCount.textContent = pendingCount;

        // Show the gate overlay with countdown
        showUploadGate(pendingCount);
        return;
    }

    // Hide gate if count dropped below threshold
    if (gateOverlay) gateOverlay.style.display = 'none';

    // Layer 2: Nag banner (≥10 and <30)
    if (pendingCount >= NAG_THRESHOLD) {
        if (nagBanner) {
            nagBanner.style.display = 'block';
            const nagCount = document.getElementById('nagPendingCount');
            if (nagCount) nagCount.textContent = pendingCount;
        }
    } else {
        if (nagBanner) nagBanner.style.display = 'none';
    }
}

/**
 * Show the friction gate overlay with a 5-second countdown.
 * User must wait before they can dismiss and continue entering data.
 */
function showUploadGate(count) {
    const gateOverlay = document.getElementById('uploadGateOverlay');
    const skipBtn = document.getElementById('gateSkipBtn');
    const countdownEl = document.getElementById('gateCountdown');
    const countEl = document.getElementById('gatePendingCount');

    if (!gateOverlay) return;

    if (countEl) countEl.textContent = count;
    gateOverlay.style.display = 'block';

    // Reset countdown
    if (_gateCountdownTimer) clearInterval(_gateCountdownTimer);
    let remaining = 5;
    if (skipBtn) {
        skipBtn.disabled = true;
        skipBtn.style.cursor = 'not-allowed';
        skipBtn.style.color = '#999';
        skipBtn.style.borderColor = '#ccc';
        skipBtn.innerHTML = '⏳ Please wait <span id="gateCountdown">' + remaining + '</span>s...';
    }

    _gateCountdownTimer = setInterval(() => {
        remaining--;
        const cdEl = document.getElementById('gateCountdown');
        if (cdEl) cdEl.textContent = remaining;

        if (remaining <= 0) {
            clearInterval(_gateCountdownTimer);
            if (skipBtn) {
                skipBtn.disabled = false;
                skipBtn.style.cursor = 'pointer';
                skipBtn.style.color = '#e65100';
                skipBtn.style.borderColor = '#e65100';
                skipBtn.innerHTML = '⚠️ I understand, let me enter one more';
            }
        }
    }, 1000);
}

/**
 * Dismiss the friction gate overlay (called from the skip button).
 * Allows the user to enter one more record before the gate re-appears.
 */
function dismissUploadGate() {
    const gateOverlay = document.getElementById('uploadGateOverlay');
    if (gateOverlay) gateOverlay.style.display = 'none';
    if (_gateCountdownTimer) {
        clearInterval(_gateCountdownTimer);
        _gateCountdownTimer = null;
    }
}

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

    // Update Certificate ID prefix label
    const certPrefix = document.getElementById('certIdPrefix');
    if (certPrefix) {
        const code = (typeof STATE_CODES !== 'undefined' && STATE_CODES[stateVal]) ? STATE_CODES[stateVal] : '??';
        certPrefix.textContent = code + '/PT/';
    }

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
            const opt = document.createElement('option');
            opt.value = 'Other';
            opt.textContent = 'Other';
            biscuitSelect.add(opt);
        }

        if (stateData.drink) {
            stateData.drink.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item;
                opt.textContent = item;
                drinkSelect.add(opt);
            });
            const opt = document.createElement('option');
            opt.value = 'Other';
            opt.textContent = 'Other';
            drinkSelect.add(opt);
        }
    } else {
        biscuitSelect.innerHTML = '<option value="">Select state first</option>';
        drinkSelect.innerHTML = '<option value="">Select state first</option>';
    }

    validateField(biscuitSelect);
    validateField(drinkSelect);
    toggleRefreshmentOther('biscuit');
    toggleRefreshmentOther('drink');
}

/**
 * Toggle "Other" text input for refreshments
 */
function toggleRefreshmentOther(id) {
    const select = document.getElementById('ref_' + id);
    const otherGroup = document.getElementById('ref_' + id + '_other_group');
    const otherInput = document.getElementById('ref_' + id + '_other');
    if (!select || !otherGroup) return;

    if (select.value === 'Other') {
        otherGroup.style.display = 'block';
        if (otherInput) otherInput.required = true;
    } else {
        otherGroup.style.display = 'none';
        if (otherInput) { otherInput.required = false; otherInput.value = ''; }
    }
}

/**
 * Fetch dynamic fields from Google Apps Script and populate the State dropdown.
 */
async function loadDynamicFields() {
    const loader = document.getElementById('dynamicFieldsLoader');
    const stateSelect = document.getElementById('state');

    // Guard: on the landing page there is no active zone/SCRIPT_URL yet
    if (!SCRIPT_URL) return;

    if (loader) loader.style.display = 'block';
    if (stateSelect) stateSelect.disabled = true;

    try {
        const resp = await fetch(SCRIPT_URL + '?action=getDynamicFields');
        const allFields = await resp.json();

        // ── Zone-based State Filtering ───────────────────────────────────────────
        // Only keep states that belong to this zone. This ensures:
        //  a) The State dropdown shows only relevant options
        //  b) Data can't be accidentally submitted to the wrong zone's sheet
        const activeZone = getActiveZone();
        if (activeZone && activeZone.states && activeZone.states.length > 0) {
            const allowedStates = new Set(activeZone.states.map(s => s.trim().toLowerCase()));
            DYNAMIC_FIELDS = {};
            Object.keys(allFields).forEach(state => {
                if (allowedStates.has(state.trim().toLowerCase())) {
                    DYNAMIC_FIELDS[state] = allFields[state];
                }
            });
        } else {
            // No zone filter defined — use all states (fallback)
            DYNAMIC_FIELDS = allFields;
        }

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

    // ── Email domain typo detection ──
    if (field.name === 'email' && field.value && field.value !== 'NA') {
        const EMAIL_TYPO_MAP = {
            'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.coom': 'gmail.com', 'gmail.cm': 'gmail.com',
            'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahoo.coom': 'yahoo.com', 'yahoo.cm': 'yahoo.com',
            'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmail.coom': 'hotmail.com', 'hotmail.cm': 'hotmail.com',
            'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com', 'outlook.coom': 'outlook.com', 'outlook.cm': 'outlook.com',
            'ymail.co': 'ymail.com', 'ymail.con': 'ymail.com', 'ymail.coom': 'ymail.com', 'ymail.cm': 'ymail.com'
        };
        const atIdx = field.value.lastIndexOf('@');
        if (atIdx > 0) {
            const domain = field.value.substring(atIdx + 1).toLowerCase();
            if (EMAIL_TYPO_MAP[domain]) {
                field.setCustomValidity('Did you mean @' + EMAIL_TYPO_MAP[domain] + '?');
                applyValidClass(field, false);
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

    // ── Snapshot hidden inputs — show/hide validation message + setCustomValidity ──
    if (field.name === 'image_pretest' || field.name === 'image_posttest') {
        const key = field.name === 'image_pretest' ? 'pretest' : 'posttest';
        const msgEl = document.getElementById(key + '_validation_msg');
        const groupEl = document.getElementById(key + '_snapshot_group');
        const hasImage = field.value && field.value.length > 0;
        field.setCustomValidity(hasImage ? '' : 'Please capture or upload a snapshot.');
        if (msgEl) msgEl.style.display = hasImage ? 'none' : 'block';
        if (groupEl) {
            groupEl.classList.toggle('snapshot-invalid', !hasImage);
            groupEl.classList.toggle('snapshot-valid', hasImage);
        }
        return;
    }

    // ── Date of Birth — allow year 1900 as special exception + calendar validity ──
    if (field.name === 'dob' && field.value) {
        const parts = field.value.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        const maxYear = new Date().getFullYear() - 10;

        // Check calendar validity (e.g. Feb 31 → JS Date overflows to Mar 3)
        const testDate = new Date(year, month - 1, day);
        if (testDate.getFullYear() !== year || testDate.getMonth() !== (month - 1) || testDate.getDate() !== day) {
            field.setCustomValidity('Invalid date — this day does not exist for the selected month.');
        } else if (year === 1900 || (year >= 1960 && year <= maxYear)) {
            field.setCustomValidity('');
        } else {
            field.setCustomValidity('Year must be 1900 (unspecified) or between 1960–' + maxYear + '.');
        }
        applyValidClass(field, field.checkValidity());
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


/**
 * Resets the form, all cascading/conditional fields, and clears validation.
 */
function resetForm() {
    const form = document.getElementById('dataForm');
    if (!form) return;

    // Reset native form
    form.reset();

    // Clear hidden inputs (snapshots)
    form.querySelectorAll('input[type="hidden"]').forEach(h => { h.value = ''; });

    // Reset cascading dropdowns
    const inputtedBySelect = document.getElementById('inputted_by');
    const trainingSelect = document.getElementById('training_details');
    const biscuitSelect = document.getElementById('ref_biscuit');
    const drinkSelect = document.getElementById('ref_drink');

    if (inputtedBySelect) inputtedBySelect.innerHTML = '<option value="">-- Select --</option>';
    if (trainingSelect) trainingSelect.innerHTML = '<option value="">Select inputted by first</option>';
    if (biscuitSelect) biscuitSelect.innerHTML = '<option value="">Select state first</option>';
    if (drinkSelect) drinkSelect.innerHTML = '<option value="">Select state first</option>';

    // Reset Certificate ID prefix
    const certPrefix = document.getElementById('certIdPrefix');
    if (certPrefix) certPrefix.textContent = '??/PT/';

    // Hide snapshot previews and reset file inputs
    ['pretest', 'posttest'].forEach(key => {
        const preview = document.getElementById('preview-' + key);
        const fileInput = document.getElementById('fileInput-' + key);
        const valMsg = document.getElementById(key + '_validation_msg');
        const groupEl = document.getElementById(key + '_snapshot_group');
        if (preview) { preview.style.display = 'none'; preview.removeAttribute('src'); }
        if (fileInput) fileInput.value = '';
        if (valMsg) valMsg.style.display = 'block';
        if (groupEl) {
            groupEl.classList.remove('snapshot-valid');
            groupEl.classList.remove('snapshot-invalid');
        }
    });

    // Re-trigger conditional field toggles (they will hide/reset sub-fields)
    toggleLevel();
    toggleJobbermanNote();
    toggleDisability();
    toggleDisabilityOther();
    toggleLanguageOther();
    togglePreferredIndustryOther();
    togglePhoneZeroNote();
    toggleExistingBusiness();
    toggleRefreshmentOther('biscuit');
    toggleRefreshmentOther('drink');

    // Re-enable all language checkboxes (in case Unfilled had disabled them)
    const form2 = document.getElementById('dataForm');
    if (form2) {
        form2.querySelectorAll('input[name="preferred_language"]').forEach(cb => {
            cb.disabled = false;
        });
    }

    // Clear all validation styling
    form.querySelectorAll('.is-valid, .is-invalid').forEach(el => {
        el.classList.remove('is-valid', 'is-invalid');
    });

    // Reset language validation message
    const langMsg = document.getElementById('lang_validation_msg');
    if (langMsg) langMsg.style.display = 'none';

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

    if (otherCb.checked && !otherCb.disabled) {
        otherGroup.style.display = 'block';
        if (otherInput) otherInput.required = true;
    } else {
        otherGroup.style.display = 'none';
        if (otherInput) { otherInput.required = false; otherInput.value = ''; }
    }
}

// ─────────────────────────────────────────────
// Preferred Industry "Other" toggle
// ─────────────────────────────────────────────
function togglePreferredIndustryOther() {
    const prefSelect = document.getElementById('preferred_industry');
    const otherGroup = document.getElementById('preferred_industry_other_group');
    const otherInput = document.getElementById('preferred_industry_other');
    if (!prefSelect || !otherGroup) return;

    if (prefSelect.value === 'Other') {
        otherGroup.style.display = 'block';
        if (otherInput) otherInput.required = true;
    } else {
        otherGroup.style.display = 'none';
        if (otherInput) { otherInput.required = false; otherInput.value = ''; }
    }
}

// ─────────────────────────────────────────────
// Existing Business → Nature of Business toggle
// ─────────────────────────────────────────────
function toggleExistingBusiness() {
    const existingSelect = document.getElementById('existing_business');
    const natureGroup = document.getElementById('business_nature_group');
    const natureSelect = document.getElementById('business_nature');
    if (!existingSelect || !natureGroup) return;

    if (existingSelect.value === 'Yes') {
        natureGroup.style.display = 'block';
        if (natureSelect) natureSelect.required = true;
    } else {
        natureGroup.style.display = 'none';
        if (natureSelect) { natureSelect.required = false; natureSelect.value = ''; }
    }
}

// ─────────────────────────────────────────────
// Phone Number Zero Check
// ─────────────────────────────────────────────
function togglePhoneZeroNote() {
    const phoneInput = document.getElementById('phone');
    const note = document.getElementById('phone_zero_note');
    if (!phoneInput || !note) return;

    if (phoneInput.value === '0') {
        note.style.display = 'block';
    } else {
        note.style.display = 'none';
    }
}

// ─────────────────────────────────────────────
// Language "Unfilled" exclusivity
// When "Unfilled (left blank)" is checked, disable all other language checkboxes.
// When any other language is checked, uncheck "Unfilled (left blank)".
// ─────────────────────────────────────────────
function enforceUnfilledExclusivity(changedCb) {
    const form = document.getElementById('dataForm');
    if (!form) return;

    const unfilledCb = document.getElementById('langUnfilled');
    if (!unfilledCb) return;

    const allLangBoxes = form.querySelectorAll('input[name="preferred_language"]');
    const otherBoxes = Array.from(allLangBoxes).filter(cb => cb.id !== 'langUnfilled');

    if (changedCb === unfilledCb) {
        if (unfilledCb.checked) {
            // Unfilled was just checked → uncheck & disable all others
            otherBoxes.forEach(cb => {
                cb.checked = false;
                cb.disabled = true;
            });
            toggleLanguageOther(); // collapse Other text input
        } else {
            // Unfilled was unchecked → re-enable all others
            otherBoxes.forEach(cb => {
                cb.disabled = false;
            });
        }
    } else if (changedCb.checked) {
        // A non-Unfilled box was checked → uncheck Unfilled
        unfilledCb.checked = false;
    }

    // Re-run language group validation
    const anyChecked = Array.from(allLangBoxes).some(cb => cb.checked);
    const langMsg = document.getElementById('lang_validation_msg');
    allLangBoxes.forEach(cb => {
        cb.setCustomValidity(anyChecked ? '' : 'Please select at least one language.');
    });
    if (langMsg) langMsg.style.display = anyChecked ? 'none' : 'block';
}

// ─────────────────────────────────────────────
// DOMContentLoaded — Wire everything up
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // ── Initialize KPI Tracker & Track Form Start ──
    if (typeof initKPI === 'function') await initKPI();
    if (typeof trackFormStart === 'function') trackFormStart();

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
        });
    }

    // ── Refreshment "Other" toggles ──
    const refBiscuitSelect = document.getElementById('ref_biscuit');
    if (refBiscuitSelect) {
        refBiscuitSelect.addEventListener('change', () => { 
            toggleRefreshmentOther('biscuit'); 
            validateField(refBiscuitSelect); 
        });
    }
    const refDrinkSelect = document.getElementById('ref_drink');
    if (refDrinkSelect) {
        refDrinkSelect.addEventListener('change', () => { 
            toggleRefreshmentOther('drink'); 
            validateField(refDrinkSelect); 
        });
    }

    // ── Qualification logic ──
    const qualSelect = document.getElementById('qualification');
    if (qualSelect) {
        qualSelect.addEventListener('change', () => { toggleLevel(); validateField(qualSelect); });
        toggleLevel();
    }

    // ── Jobberman SST cross-check note ──
    const sstSelect = document.getElementById('jobberman_sst');
    if (sstSelect) {
        sstSelect.addEventListener('change', () => { toggleJobbermanNote(); validateField(sstSelect); });
        toggleJobbermanNote();
    }

    // ── Disability toggle ──
    const disSelect = document.getElementById('disability');
    if (disSelect) {
        disSelect.addEventListener('change', () => { toggleDisability(); validateField(disSelect); });
        toggleDisability();
    }
    const disTypeSelect = document.getElementById('disability_type');
    if (disTypeSelect) {
        disTypeSelect.addEventListener('change', () => { toggleDisabilityOther(); validateField(disTypeSelect); });
        toggleDisabilityOther();
    }

    // ── Language "Other" checkbox toggle + Unfilled exclusivity ──
    const langOtherCb = document.getElementById('langOther');
    if (langOtherCb) {
        langOtherCb.addEventListener('change', () => { toggleLanguageOther(); });
        toggleLanguageOther();
    }

    // Wire Unfilled exclusivity to ALL language checkboxes
    form.querySelectorAll('input[name="preferred_language"]').forEach(cb => {
        cb.addEventListener('change', () => {
            enforceUnfilledExclusivity(cb);
        });
    });

    // ── Preferred Industry toggle ──
    const prefIndSelect = document.getElementById('preferred_industry');
    if (prefIndSelect) {
        prefIndSelect.addEventListener('change', () => { togglePreferredIndustryOther(); validateField(prefIndSelect); });
        togglePreferredIndustryOther();
    }

    // ── Phone Zero Check ──
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', togglePhoneZeroNote);
        togglePhoneZeroNote();
    }

    // ── Existing Business toggle ──
    const existingBizSelect = document.getElementById('existing_business');
    if (existingBizSelect) {
        existingBizSelect.addEventListener('change', () => { toggleExistingBusiness(); validateField(existingBizSelect); });
        toggleExistingBusiness();
    }

    // ── Attach real-time validation to ALL form fields ──
    form.querySelectorAll('input, select, textarea').forEach(field => {
        const events = (field.type === 'checkbox' || field.type === 'radio')
            ? ['change']
            : ['input', 'blur', 'change'];

        events.forEach(evt => {
            field.addEventListener(evt, () => {
                validateField(field);
            });
        });
    });

    // ── Check upload enforcement on page load ──
    checkUploadEnforcement();

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

        // ── Explicit snapshot validation ──
        // Hidden inputs are exempt from browser constraint validation,
        // so checkValidity() always returns true for them. We must check manually.
        let snapshotValid = true;
        ['pretest', 'posttest'].forEach(key => {
            const hiddenInput = document.getElementById('imgData-' + key);
            const hasImage = hiddenInput && hiddenInput.value && hiddenInput.value.length > 0;
            if (!hasImage) {
                snapshotValid = false;
                const msgEl = document.getElementById(key + '_validation_msg');
                const groupEl = document.getElementById(key + '_snapshot_group');
                if (msgEl) msgEl.style.display = 'block';
                if (groupEl) {
                    groupEl.classList.add('snapshot-invalid');
                    groupEl.classList.remove('snapshot-valid');
                }
            }
        });

        // Check validity without adding was-validated class
        const formValid = this.checkValidity();
        if (!formValid || !snapshotValid) {
            event.stopPropagation();

            // Scroll to first invalid element (regular field or snapshot group)
            const firstInvalid = this.querySelector('.is-invalid, .snapshot-invalid');
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

        // ── Certificate ID: concatenate SC/PT/digits (or SC/PT/NA) ──
        if (payload.certificate_id) {
            const stateVal = payload.state || '';
            const stateCode = (typeof STATE_CODES !== 'undefined' && STATE_CODES[stateVal]) ? STATE_CODES[stateVal] : '??';
            // Force NA to be uppercase just in case
            if (payload.certificate_id.toUpperCase() === 'NA') {
                payload.certificate_id = stateCode + '/PT/NA';
            } else {
                payload.certificate_id = stateCode + '/PT/' + payload.certificate_id;
            }
        }

        // ── Merge "Other" text inputs into parent fields ──
        // Disability type: if "Other" was selected, use the typed value
        if (payload.disability_type === 'Other' && payload.disability_type_other) {
            payload.disability_type = payload.disability_type_other;
        }
        delete payload.disability_type_other;

        // Preferred industry: if "Other" was selected, use the typed value
        if (payload.preferred_industry === 'Other' && payload.preferred_industry_other) {
            payload.preferred_industry = payload.preferred_industry_other;
        }
        delete payload.preferred_industry_other;

        // Refreshments: if "Other" was selected, use the typed value
        ['biscuit', 'drink'].forEach(id => {
            const key = 'ref_' + id;
            const otherKey = 'ref_' + id + '_other';
            if (payload[key] === 'Other' && payload[otherKey]) {
                payload[key] = payload[otherKey];
            }
            delete payload[otherKey];
        });

        // Preferred language: if "Other" was checked, replace it with the typed value
        if (payload.preferred_language && payload.preferred_language.includes('Other')) {
            const otherText = payload.preferred_language_other || 'Other';
            payload.preferred_language = payload.preferred_language
                .split(', ')
                .map(lang => lang === 'Other' ? otherText : lang)
                .join(', ');
        }
        delete payload.preferred_language_other;

        // ── Phone number prepending 234 ──
        if (payload.phone && payload.phone !== '0' && payload.phone !== 'NA' && !payload.phone.startsWith('234')) {
            payload.phone = '234' + payload.phone;
        }
        if (payload.alt_phone && payload.alt_phone !== '0' && payload.alt_phone !== 'NA' && !payload.alt_phone.startsWith('234')) {
            payload.alt_phone = '234' + payload.alt_phone;
        }

        console.log('Saving payload locally:', payload);

        // ── Save to IndexedDB (offline-first) ──
        const images = {
            pretest: payload.image_pretest || '',
            posttest: payload.image_posttest || ''
        };
        // Remove raw image data from payload (stored as Blobs separately)
        delete payload.image_pretest;
        delete payload.image_posttest;

        // Wrap saveSubmission in a race timeout so it doesn't hang forever if IndexedDB freezes
        const savePromise = saveSubmission(payload, images);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('Storage is busy or taking too long. Please restart your browser or free up space and try again.'));
            }, 25000);
        });

        try {
            Promise.race([savePromise, timeoutPromise])
                .then(async (result) => {

                    // Track KPI metrics
                    if (typeof trackFormSaved === 'function') trackFormSaved();

                    // Increment session save counter
                    const SESSION_COUNT_KEY = 'jobberman_submission_count';
                    let count = 1;
                    try {
                        count = parseInt(sessionStorage.getItem(SESSION_COUNT_KEY) || '0', 10) + 1;
                        sessionStorage.setItem(SESSION_COUNT_KEY, count.toString());
                    } catch (e) {}

                    // Show success screen, hide form
                    document.getElementById('dataForm').style.display = 'none';
                    const successScreen = document.getElementById('successScreen');
                    successScreen.style.display = 'block';
                    document.getElementById('submissionCount').textContent = count;

                    // Update pending count on success screen
                    const pendingCount = await getPendingCount();
                    const pendingEl = document.getElementById('pendingCountSuccess');
                    if (pendingEl) pendingEl.textContent = pendingCount;

                    // Update the floating badge
                    updateQueueBadge();

                    // Broadcast to queue page that a new entry was saved
                    broadcastMessage('entry_saved', { id: result.id, uuid: result.uuid });

                    // ── Auto-upload if online ──
                    // Immediately upload THIS entry in the background.
                    // Uses uploadSingle so it doesn't interfere with a running batch.
                    if (navigator.onLine && typeof uploadSingle === 'function') {
                        console.log('[AutoSync] Entry saved while online — uploading entry', result.id);
                        uploadSingle(result.id); // runs async, doesn't block the UI
                    }

                    // ── Check upload enforcement (nag / gate) ──
                    checkUploadEnforcement();

                    // Re-trigger the SVG animation by cloning and replacing the SVG
                    const svg = successScreen.querySelector('.success-checkmark svg');
                    if (svg) {
                        const clone = svg.cloneNode(true);
                        svg.parentNode.replaceChild(clone, svg);
                    }

                    // Scroll to top
                    window.scrollTo({ top: 0, behavior: 'smooth' });

                    // Re-enable button behind the scenes in case they click "Submit Another"
                    subBtn.disabled = false;
                    subBtn.innerHTML = '💾 Save Entry';
                    loader.style.display = 'none';
                })
                .catch(err => {
                    console.error('[saveSubmission error]', err);
                    alert(`[ERR_IDB_SAVE] Error saving entry to local database:\n${err.message}\n\nDiag: If this persists, check if your device storage is full or if the browser is blocking offline data.`);
                    subBtn.disabled = false;
                    subBtn.innerHTML = '💾 Save Entry';
                    loader.style.display = 'none';
                });
        } catch (syncErr) {
            console.error('[Sync Mapping Error]', syncErr);
            alert(`[ERR_FORM_PROCESS] A critical error occurred while gathering form data:\n${syncErr.message}\n\nDiag: Check for missing or invalid fields, or try refreshing the page.`);
            subBtn.disabled = false;
            subBtn.innerHTML = '💾 Save Entry';
            loader.style.display = 'none';
        }
    });

    // ── "Submit Another Response" Button Handler ──
    const submitAnotherBtn = document.getElementById('submitAnotherBtn');
    if (submitAnotherBtn) {
        submitAnotherBtn.addEventListener('click', async () => {
            // Hide success screen, show form
            document.getElementById('successScreen').style.display = 'none';
            const formEl = document.getElementById('dataForm');
            formEl.style.display = 'block';

            // Reset the form
            resetForm();

            // Track start time for the next entry
            if (typeof trackFormStart === 'function') trackFormStart();

            // Re-enable submit button
            const subBtn = document.getElementById('subBtn');
            if (subBtn) {
                subBtn.disabled = false;
                subBtn.innerHTML = '💾 Save Entry';
            }
            document.getElementById('loader').style.display = 'none';

            // Update badge
            await updateQueueBadge();

            // ── Check upload enforcement before allowing another entry ──
            await checkUploadEnforcement();

            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ── "Reset Counter" Button Handler ──
    const resetCounterBtn = document.getElementById('resetCounterBtn');
    if (resetCounterBtn) {
        resetCounterBtn.addEventListener('click', () => {
            try { sessionStorage.removeItem('jobberman_submission_count'); } catch (e) {}
            document.getElementById('submissionCount').textContent = '0';
        });
    }

    // ── Update Queue Badge on page load ──
    updateQueueBadge();

    // ── Listen for broadcast messages (from uploads on any page) ──
    onBroadcastMessage((msg) => {
        switch (msg.type) {
            case 'auto_sync_started':
                showSyncToast('⬆️ Uploading ' + msg.count + ' entries...', 'uploading');
                break;
            case 'upload_started':
                showSyncToast('⬆️ Uploading ' + msg.total + ' entries...', 'uploading');
                break;
            case 'upload_progress':
                updateQueueBadge();
                if (msg.status === 'confirmed') {
                    showSyncToast('✅ ' + msg.current + '/' + msg.total + ' uploaded', 'progress');
                }
                break;
            case 'upload_waiting':
                showSyncToast('🕒 Server busy — retrying in ' + msg.waitSeconds + 's...', 'waiting');
                break;
            case 'upload_complete':
                updateQueueBadge();
                if (msg.uploaded > 0 && msg.failed === 0) {
                    showSyncToast('✅ All ' + msg.uploaded + ' entries uploaded!', 'done');
                } else if (msg.uploaded > 0 && msg.failed > 0) {
                    showSyncToast('⚠️ ' + msg.uploaded + ' uploaded, ' + msg.failed + ' failed', 'warning');
                }
                break;
            case 'entry_updated':
            case 'entry_saved':
                updateQueueBadge();
                break;
        }
    });
});

// ─────────────────────────────────────────────
// Queue Badge (Bottom Tab Bar)
// ─────────────────────────────────────────────

/**
 * Update the queue tab badge with the current pending count.
 */
async function updateQueueBadge() {
    try {
        const count = await getPendingCount();
        const badgeEl = document.getElementById('queueBadgeCount');
        if (badgeEl) {
            badgeEl.textContent = count;
            badgeEl.style.display = count > 0 ? 'inline-flex' : 'none';
        }
    } catch (e) {
        // IndexedDB not ready yet — ignore
    }
}

// ─────────────────────────────────────────────
// Sync Toast (non-intrusive upload status)
// ─────────────────────────────────────────────

let _syncToastTimeout = null;

/**
 * Show a small, non-intrusive toast above the bottom tab bar
 * to indicate background upload activity.
 *
 * @param {string} text - Message to display
 * @param {string} type - 'uploading' | 'progress' | 'done' | 'warning' | 'waiting'
 */
function showSyncToast(text, type) {
    let toast = document.getElementById('syncToast');

    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'syncToast';
        toast.style.cssText =
            'position:fixed;bottom:68px;left:50%;transform:translateX(-50%);' +
            'padding:8px 18px;border-radius:20px;font-size:0.8rem;font-weight:600;' +
            'z-index:1050;pointer-events:none;transition:all 0.3s ease;' +
            'box-shadow:0 4px 16px rgba(0,0,0,0.15);white-space:nowrap;max-width:90%;' +
            'text-overflow:ellipsis;overflow:hidden;';
        document.body.appendChild(toast);
    }

    // Style by type
    const styles = {
        uploading: 'background:#1565c0;color:#fff;',
        progress: 'background:#1565c0;color:#fff;',
        done: 'background:#2e7d32;color:#fff;',
        warning: 'background:#e65100;color:#fff;',
        waiting: 'background:#f57c00;color:#fff;'
    };
    toast.style.cssText = toast.style.cssText.replace(/background:[^;]+;color:[^;]+;/g, '');
    toast.style.cssText += styles[type] || styles.uploading;

    toast.textContent = text;
    toast.style.opacity = '1';

    // Clear previous auto-hide timer
    if (_syncToastTimeout) clearTimeout(_syncToastTimeout);

    // Auto-hide after delay (longer for final states)
    const delay = (type === 'done' || type === 'warning') ? 5000 : 3000;
    _syncToastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
    }, delay);
}
