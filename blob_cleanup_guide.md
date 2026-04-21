# Legacy Blob Cleanup Guide

Once you are confident that all users have successully uploaded their old pending entries and their queues are clear, you can safely remove the legacy Blob workarounds from the codebase. All new entries save images strictly as **base64 strings**, rendering these backwards-compatibility shims obsolete.

### 1. `db.js` Cleanup

#### Remove `dataUrlToBlob` completely
This function is currently just a pass-through returning the base64 string.
- Delete the `dataUrlToBlob` function.
- In `saveSubmission`, assign the base64 strings directly:
  ```javascript
  const record = {
      // ...
      pretestBlob: images.pretest || '',
      posttestBlob: images.posttest || '',
      // ...
  };
  ```
  *(Note: You can leave the property names as `pretestBlob` so you don't have to migrate existing valid database rows)*

#### Remove `blobToDataUrl` completely
This function contains the complex 10-second `Promise.race` timeout designed to combat iOS Blob invalidation. Since all entries are now base64 strings, we don't need `FileReader` anymore.
- Delete the `blobToDataUrl` function.

#### Remove `migrateBlobsToBase64` completely
This function runs heavily on page load to eagerly convert old Blobs before iOS Safari kills them.
- Delete the `migrateBlobsToBase64` function entirely.

### 2. `uploader.js` Cleanup

#### Remove the migration call on Page Load
At the bottom of `uploader.js` (around line ~414), remove the step that triggers the migration:
```javascript
// Remove this entire block:
return migrateBlobsToBase64();
}).then(migrationResult => {
    // ...
```
Just enable auto-sync directly instead:
```javascript
resetStuckUploading().then(count => {
    if (count > 0) {
        console.log('[AutoSync] Reset ' + count + ' stuck entries back to pending');
    }
    enableAutoSync();
}).catch(() => {
    enableAutoSync();
});
```

#### Strip conversion from `uploadAll` and `uploadSingle`
In both `uploadAll()` and `uploadSingle()`, remove the explicit conversions and construct the payload directly:

**From:**
```javascript
const pretestDataUrl = await blobToDataUrl(record.pretestBlob);
const posttestDataUrl = await blobToDataUrl(record.posttestBlob);

const fullPayload = {
    ...record.payload,
    image_pretest: pretestDataUrl,
    image_posttest: posttestDataUrl,
    uuid: record.uuid
};
```

**To:**
```javascript
const fullPayload = {
    ...record.payload,
    image_pretest: record.pretestBlob, // It's already a base64 string now
    image_posttest: record.posttestBlob,
    uuid: record.uuid
};
```

### 3. `queue.js` Cleanup (Optional but Recommended)

In `updateSnapshotView()`, you may still have backwards capability logic:
```javascript
function createDisplaySrc(blobOrString) {
    if (!blobOrString) return '';
    if (typeof blobOrString === 'string') return blobOrString;
    return URL.createObjectURL(blobOrString);
}
```
You can simplify this to just return the string directly, removing the need for `URL.createObjectURL()`.

---

**Final Step:** Bump the `sw.js` cache version.
After deleting these functions, you will have a much leaner, less error-prone `db.js` and `uploader.js`, and the iOS Blob issue will be fully eradicated from history!
