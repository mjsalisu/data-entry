A high number of feedback shows that the submission process is very slow.

    The primary bottleneck: two large base64 images (2048px, 0.92 quality JPEG) are embedded in the JSON payload and sent in a single synchronous POST to Google Apps Script, which then decodes and uploads them to Drive before appending the sheet row.

Split submission into two requests:
    1: POST text-only data → append row instantly (fast)
    2: POST images separately → upload to Drive, update the row with URLs

All 3 optimizations are implemented:

    1. Image compression (camera.js) — 2048→1024px, 0.92→0.6 quality (~80% smaller payload)
    2. Optimistic submission (app.js) — success screen appears instantly; data sends in background
    3. Error handling (app.js + style.css) — network failures show a floating toast instead of blocking alert()

No changes needed to code.gs. Submissions should now feel instant instead of waiting 5–15 seconds.

