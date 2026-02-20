let stream = null;
let activeType = null;

async function openCam(type) {
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
    }
    activeType = type;
    const padding = type ? '-' + type : ''; // legacy support if needed, though we updated index.html to use 'pretest' and 'posttest'

    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = document.getElementById('video' + padding);
        video.srcObject = stream;
        document.getElementById('camera-box' + padding).style.display = 'block';
        // Hide the open button
        // The button doesn't have a unique ID in the new HTML for opening, it calls openCam('type')
        // We can find the button relative to the container or just leave it. 
        // In the new HTML: <button ... onclick="openCam('pretest')">
        // It's not easily selectable by ID unless we add IDs to the buttons.
        // Let's just show the camera box.

        document.getElementById('preview' + padding).style.display = 'none';
    } catch (err) {
        alert("Error accessing camera: " + err.message);
    }
}

function capture(type) {
    const padding = type ? '-' + type : '';
    const video = document.getElementById('video' + padding);
    if (!video.srcObject) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    const data = canvas.toDataURL('image/jpeg', 0.7);
    document.getElementById('imgData' + padding).value = data;

    const preview = document.getElementById('preview' + padding);
    preview.src = data;
    preview.style.display = 'block';

    document.getElementById('camera-box' + padding).style.display = 'none';

    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
}
