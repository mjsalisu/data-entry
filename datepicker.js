/**
 * Custom Scroll-Wheel Date Picker
 * Three swipeable columns: Day (1–31), Month (Jan–Dec), Year (1900 + 1960–maxYear)
 */
(function () {
    'use strict';

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const ITEM_HEIGHT = 44;   // px per row
    const VISIBLE = 5;        // rows visible in wheel
    const CENTER = Math.floor(VISIBLE / 2);

    // Build year list: 1900 + 1960..maxYear
    function buildYears() {
        const maxYear = new Date().getFullYear() - 10;
        const years = [1900];
        for (let y = 1960; y <= maxYear; y++) years.push(y);
        return years;
    }

    // ── Inject CSS once ──
    const style = document.createElement('style');
    style.textContent = `
    .dp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .25s ease}
    .dp-overlay.open{opacity:1}
    .dp-sheet{background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:420px;padding:0 0 env(safe-area-inset-bottom);transform:translateY(100%);transition:transform .3s cubic-bezier(.4,0,.2,1)}
    .dp-overlay.open .dp-sheet{transform:translateY(0)}
    .dp-header{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid #e9ecef}
    .dp-header button{border:none;background:none;font-size:.95rem;font-weight:600;cursor:pointer;padding:6px 14px;border-radius:8px}
    .dp-cancel{color:#6c757d}
    .dp-cancel:hover{background:#f1f3f5}
    .dp-done{color:#0d6efd}
    .dp-done:hover{background:#e7f1ff}
    .dp-title{font-weight:700;font-size:1rem;color:#212529}
    .dp-wheels{display:flex;height:${ITEM_HEIGHT * VISIBLE}px;overflow:hidden;position:relative;user-select:none}
    .dp-col{flex:1;position:relative;overflow:hidden}
    .dp-col-inner{transition:transform .15s ease-out}
    .dp-item{height:${ITEM_HEIGHT}px;display:flex;align-items:center;justify-content:center;font-size:1.05rem;color:#adb5bd;white-space:nowrap;transition:color .15s,font-weight .15s,transform .15s}
    .dp-item.active{color:#212529;font-weight:700;font-size:1.15rem}
    .dp-item.near{color:#6c757d;font-size:1rem}
    .dp-highlight{position:absolute;top:${ITEM_HEIGHT * CENTER}px;left:0;right:0;height:${ITEM_HEIGHT}px;border-top:2px solid #0d6efd;border-bottom:2px solid #0d6efd;pointer-events:none;background:rgba(13,110,253,.04);border-radius:6px}
    .dp-label{position:absolute;top:0;left:0;right:0;text-align:center;font-size:.7rem;font-weight:600;color:#6c757d;letter-spacing:.5px;text-transform:uppercase;padding:2px 0;background:#f8f9fa;border-bottom:1px solid #e9ecef;z-index:1}
    `;
    document.head.appendChild(style);

    // ── Column wheel class ──
    class Wheel {
        constructor(container, items, label) {
            this.items = items;
            this.idx = 0;
            this.startY = 0;
            this.currentOffset = 0;
            this.velocity = 0;
            this.lastY = 0;
            this.lastTime = 0;
            this.animFrame = null;

            this.el = document.createElement('div');
            this.el.className = 'dp-col';

            // Label
            const lbl = document.createElement('div');
            lbl.className = 'dp-label';
            lbl.textContent = label;
            this.el.appendChild(lbl);

            // Highlight bar
            const hl = document.createElement('div');
            hl.className = 'dp-highlight';
            hl.style.top = (ITEM_HEIGHT * CENTER + 22) + 'px'; // offset for label
            this.el.appendChild(hl);

            // Inner scrollable
            this.inner = document.createElement('div');
            this.inner.className = 'dp-col-inner';
            this.inner.style.paddingTop = '22px'; // space for label

            // Render items with padding
            for (let i = 0; i < CENTER; i++) this._addItem('');
            items.forEach(v => this._addItem(String(v)));
            for (let i = 0; i < CENTER; i++) this._addItem('');

            this.el.appendChild(this.inner);
            container.appendChild(this.el);

            // Touch events
            this.el.addEventListener('touchstart', e => this._onStart(e.touches[0].clientY), { passive: true });
            this.el.addEventListener('touchmove', e => { e.preventDefault(); this._onMove(e.touches[0].clientY); }, { passive: false });
            this.el.addEventListener('touchend', () => this._onEnd());

            // Mouse events (desktop)
            this.el.addEventListener('mousedown', e => { this._mouseDown = true; this._onStart(e.clientY); });
            this.el.addEventListener('mousemove', e => { if (this._mouseDown) this._onMove(e.clientY); });
            this.el.addEventListener('mouseup', () => { this._mouseDown = false; this._onEnd(); });
            this.el.addEventListener('mouseleave', () => { if (this._mouseDown) { this._mouseDown = false; this._onEnd(); } });

            // Scroll wheel
            this.el.addEventListener('wheel', e => {
                e.preventDefault();
                const dir = e.deltaY > 0 ? 1 : -1;
                this.setIndex(Math.max(0, Math.min(this.items.length - 1, this.idx + dir)));
            }, { passive: false });

            this._updateTransform();
        }

        _addItem(text) {
            const d = document.createElement('div');
            d.className = 'dp-item';
            d.textContent = text;
            this.inner.appendChild(d);
        }

        _onStart(y) {
            cancelAnimationFrame(this.animFrame);
            this.startY = y;
            this.currentOffset = -this.idx * ITEM_HEIGHT;
            this.velocity = 0;
            this.lastY = y;
            this.lastTime = Date.now();
        }

        _onMove(y) {
            const now = Date.now();
            const dt = now - this.lastTime || 1;
            this.velocity = (y - this.lastY) / dt;
            this.lastY = y;
            this.lastTime = now;

            const delta = y - this.startY;
            const offset = this.currentOffset + delta;
            const maxOffset = 0;
            const minOffset = -(this.items.length - 1) * ITEM_HEIGHT;
            const clamped = Math.max(minOffset - ITEM_HEIGHT, Math.min(maxOffset + ITEM_HEIGHT, offset));
            this.inner.style.transform = `translateY(${clamped}px)`;
            this.inner.style.transition = 'none';
        }

        _onEnd() {
            const rawOffset = parseFloat(this.inner.style.transform.replace(/[^-\d.]/g, '')) || 0;
            // Apply momentum
            const momentum = this.velocity * 120;
            const projected = rawOffset + momentum;
            let newIdx = Math.round(-projected / ITEM_HEIGHT);
            newIdx = Math.max(0, Math.min(this.items.length - 1, newIdx));
            this.setIndex(newIdx);
        }

        setIndex(i) {
            this.idx = i;
            this._updateTransform();
            this._updateStyles();
        }

        _updateTransform() {
            this.inner.style.transition = 'transform .25s cubic-bezier(.4,0,.2,1)';
            this.inner.style.transform = `translateY(${-this.idx * ITEM_HEIGHT}px)`;
        }

        _updateStyles() {
            const allItems = this.inner.querySelectorAll('.dp-item');
            allItems.forEach((el, i) => {
                const actualIdx = i - CENTER;
                el.classList.remove('active', 'near');
                if (actualIdx === this.idx) el.classList.add('active');
                else if (Math.abs(actualIdx - this.idx) === 1) el.classList.add('near');
            });
        }

        getValue() { return this.items[this.idx]; }
    }

    // ── Main picker ──
    let overlay = null;
    let targetInput = null;

    function openPicker(input) {
        if (overlay) return;
        targetInput = input;

        const years = buildYears();
        const days = [];
        for (let d = 1; d <= 31; d++) days.push(d);

        // Parse current value
        let initDay = 1, initMonth = 0, initYear = years.indexOf(2000) >= 0 ? years.indexOf(2000) : 0;
        if (input.value) {
            const parts = input.value.split('-');
            if (parts.length === 3) {
                const y = parseInt(parts[0]), m = parseInt(parts[1]) - 1, d = parseInt(parts[2]);
                const yi = years.indexOf(y);
                if (yi >= 0) initYear = yi;
                initMonth = m;
                initDay = d - 1;
            }
        }

        // Overlay
        overlay = document.createElement('div');
        overlay.className = 'dp-overlay';
        overlay.addEventListener('click', e => { if (e.target === overlay) closePicker(); });

        // Sheet
        const sheet = document.createElement('div');
        sheet.className = 'dp-sheet';

        // Header
        const header = document.createElement('div');
        header.className = 'dp-header';
        header.innerHTML = `
            <button class="dp-cancel" type="button">Cancel</button>
            <span class="dp-title">Date of Birth</span>
            <button class="dp-done" type="button">Done</button>`;
        header.querySelector('.dp-cancel').addEventListener('click', closePicker);
        header.querySelector('.dp-done').addEventListener('click', () => confirmPicker(years));
        sheet.appendChild(header);

        // Wheels container
        const wheels = document.createElement('div');
        wheels.className = 'dp-wheels';

        const dayWheel = new Wheel(wheels, days, 'Day');
        const monthWheel = new Wheel(wheels, MONTHS, 'Month');
        const yearWheel = new Wheel(wheels, years, 'Year');

        sheet.appendChild(wheels);
        overlay.appendChild(sheet);
        document.body.appendChild(overlay);

        // Store wheel refs
        overlay._dayWheel = dayWheel;
        overlay._monthWheel = monthWheel;
        overlay._yearWheel = yearWheel;

        // Set initial values
        dayWheel.setIndex(initDay);
        monthWheel.setIndex(initMonth);
        yearWheel.setIndex(initYear);

        // Animate in
        requestAnimationFrame(() => overlay.classList.add('open'));
    }

    function confirmPicker(years) {
        if (!overlay || !targetInput) return;
        const day = overlay._dayWheel.getValue();
        const monthIdx = overlay._monthWheel.idx;
        const year = overlay._yearWheel.getValue();

        // Format as YYYY-MM-DD for the date input
        const mm = String(monthIdx + 1).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        targetInput.value = `${year}-${mm}-${dd}`;

        // Trigger validation
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof validateField === 'function') validateField(targetInput);
        if (typeof saveDraft === 'function') saveDraft();

        closePicker();
    }

    function closePicker() {
        if (!overlay) return;
        overlay.classList.remove('open');
        setTimeout(() => {
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            overlay = null;
            targetInput = null;
        }, 300);
    }

    // ── Attach to DOB field on DOMContentLoaded ──
    document.addEventListener('DOMContentLoaded', () => {
        const dobInput = document.getElementById('dob');
        if (!dobInput) return;

        // Prevent native picker from opening
        dobInput.addEventListener('click', e => {
            e.preventDefault();
            openPicker(dobInput);
        });
        dobInput.addEventListener('focus', e => {
            e.preventDefault();
            dobInput.blur();
            openPicker(dobInput);
        });
    });
})();
