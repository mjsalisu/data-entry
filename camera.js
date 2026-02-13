let stream = null;

async function openCam() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = document.getElementById('video');
        video.srcObject = stream;
        document.getElementById('camera-box').style.display = 'block';
        document.getElementById('camBtn').style.display = 'none';
        document.getElementById('preview').style.display = 'none';
    } catch (err) {
        alert("Error accessing camera: " + err.message);
    }
}

function capture() {
    const video = document.getElementById('video');
    if (!video.srcObject) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    const data = canvas.toDataURL('image/jpeg', 0.7);
    document.getElementById('imgData').value = data;
    document.getElementById('preview').src = data;
    document.getElementById('preview').style.display = 'block';

    document.getElementById('camera-box').style.display = 'none';
    const camBtn = document.getElementById('camBtn');
    camBtn.innerText = "🔄 Retake Photo";
    camBtn.style.display = 'block';

    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
}
