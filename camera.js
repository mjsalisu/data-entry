/**
 * camera.js — Native file input handler for PreTest / PostTest snapshots.
 *
 * Instead of in-browser getUserMedia, we use <input type="file" capture="environment">
 * which opens the device's native camera (with flashlight, zoom, autofocus, HDR, etc.)
 * or lets the user pick from gallery.
 *
 * Images are resized to max 2048px on the longest side and stored as high-quality JPEG
 * (quality 0.92) in the hidden imgData input as a data URL.
 */

const MAX_IMAGE_DIMENSION = 2048;
const JPEG_QUALITY = 0.98; // Increased from 0.92 for near-lossless crystal clear images

/**
 * Called when the user selects/captures a file via the native file input.
 * @param {string} type - 'pretest' or 'posttest'
 * @param {HTMLInputElement} fileInput - The file input element
 */
function handleFileSelect(type, fileInput) {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    // Validate that it's an image
    if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file.');
        fileInput.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            // Resize to max dimension while keeping aspect ratio
            let width = img.width;
            let height = img.height;

            if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
                if (width > height) {
                    height = Math.round(height * (MAX_IMAGE_DIMENSION / width));
                    width = MAX_IMAGE_DIMENSION;
                } else {
                    width = Math.round(width * (MAX_IMAGE_DIMENSION / height));
                    height = MAX_IMAGE_DIMENSION;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);

            // Store in hidden input
            const hiddenInput = document.getElementById('imgData-' + type);
            if (hiddenInput) {
                hiddenInput.value = dataUrl;
                // Trigger validation
                if (typeof validateField === 'function') validateField(hiddenInput);
            }

            // Show preview
            const preview = document.getElementById('preview-' + type);
            if (preview) {
                preview.src = dataUrl;
                preview.style.display = 'block';
            }

            // Hide validation message
            const msgEl = document.getElementById(type + '_validation_msg');
            if (msgEl) msgEl.style.display = 'none';

            // Remove invalid styling from group
            const groupEl = document.getElementById(type + '_snapshot_group');
            if (groupEl) {
                groupEl.classList.remove('snapshot-invalid');
                groupEl.classList.add('snapshot-valid');
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
