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
    const dataForm = document.getElementById('dataForm');
    if (dataForm) {
        dataForm.onsubmit = function (e) {
            e.preventDefault();
            if (!document.getElementById('imgData').value) {
                return alert("Photo required!");
            }

            const subBtn = document.getElementById('subBtn');
            const loader = document.getElementById('loader');

            subBtn.disabled = true;
            loader.style.display = 'block';

            const payload = {};
            new FormData(this).forEach((v, k) => payload[k] = v);

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
                    loader.style.display = 'none';
                });
        };
    }
});
