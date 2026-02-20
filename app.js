// app.js
function updateLocs() {
    const stateVal = document.getElementById('state').value;
    const locSelect = document.getElementById('location');
    locSelect.innerHTML = '<option value="">-- Select --</option>';

    if (LOCS[stateVal]) {
        LOCS[stateVal].forEach(loc => {
            let opt = document.createElement('option');
            opt.value = loc;
            opt.textContent = loc;
            locSelect.add(opt);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Qualification Logic
    const qualSelect = document.getElementById('qualification');
    const levelGroup = document.getElementById('current_level_group');

    function toggleLevel() {
        if (qualSelect && levelGroup) {
            if (qualSelect.value === 'Undergraduate') {
                levelGroup.style.display = 'block';
                const levelSelect = levelGroup.querySelector('select');
                if (levelSelect) levelSelect.required = true;
            } else {
                levelGroup.style.display = 'none';
                const levelSelect = levelGroup.querySelector('select');
                if (levelSelect) {
                    levelSelect.required = false;
                    levelSelect.value = "";
                }
            }
        }
    }

    if (qualSelect) {
        qualSelect.addEventListener('change', toggleLevel);
        // Run on load in case of pre-fill
        toggleLevel();
    }

    // Date of Birth Logic
    const dobInput = document.querySelector('input[name="dob"]');
    if (dobInput) {
        dobInput.addEventListener('blur', function () {
            let val = this.value.trim();
            if (!val) return;

            // Simple parser logic
            // 1. Check if year is missing
            const yearMatch = val.match(/\d{4}$/);
            if (!yearMatch) {
                // If no 4-digit year at end, append 1900
                val += " 1900";
            }

            // 2. Try to parse date
            const dateObj = new Date(val);
            if (!isNaN(dateObj.getTime())) {
                const day = dateObj.getDate();
                const month = dateObj.toLocaleString('default', { month: 'short' });
                const year = dateObj.getFullYear();
                this.value = `${day} ${month}, ${year}`;
            }
        });
    }

    const dataForm = document.getElementById('dataForm');
    if (dataForm) {
        dataForm.addEventListener('submit', function (event) {

            // 1. Custom Validation Logic BEFORE Bootstrap check
            const emailInput = this.elements['email'];
            const phoneInput = this.elements['phone'];

            // Reset custom validity checks first
            emailInput.setCustomValidity("");
            phoneInput.setCustomValidity("");

            const email = emailInput.value;
            const phone = phoneInput.value;

            // Logic: Invalid if Email is "NA" AND Phone is "0"
            if (email === 'NA' && phone === '0') {
                const msg = 'Script is invalid if both Email is "NA" and Phone is "0".';
                emailInput.setCustomValidity(msg);
                phoneInput.setCustomValidity(msg);

                // Also trigger alert for immediate feedback
                alert(msg);
            }

            // 2. Bootstrap 5 Validation Check
            if (!this.checkValidity()) {
                event.preventDefault();
                event.stopPropagation();
                // Add class to show validation feedback
                this.classList.add('was-validated');
                return; // Stop here if invalid
            }

            // 3. If valid, proceed with submission
            event.preventDefault(); // Prevent default since we use fetch

            const subBtn = document.getElementById('subBtn');
            const loader = document.getElementById('loader');

            subBtn.disabled = true;
            subBtn.innerHTML = 'Submitting...'; // Feedback on button
            loader.style.display = 'block';

            const payload = {};
            const formData = new FormData(this);

            // Handle checkboxes (like refreshments) manually to get array
            const refreshments = [];
            // Use querySelectorAll to find checked inputs with name 'refreshments' within the form
            this.querySelectorAll('input[name="refreshments"]:checked').forEach((checkbox) => {
                refreshments.push(checkbox.value);
            });
            if (refreshments.length > 0) {
                payload['refreshments'] = refreshments.join(', ');
            }

            formData.forEach((v, k) => {
                if (k !== 'refreshments') {
                    payload[k] = v;
                }
            });

            console.log("Submitting payload:", payload);

            fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(payload),
                mode: 'no-cors'
            })
                .then(() => {
                    alert("Registration Sent! Checking the sheet now...");
                    location.reload();
                })
                .catch(err => {
                    alert("Error: " + err.message);
                    subBtn.disabled = false;
                    subBtn.innerHTML = 'Submit Registration';
                    loader.style.display = 'none';
                });
        });
    }
});
