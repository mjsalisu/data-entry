/**
 * Handles incoming data from the external HTML form (Jobberman SST Data Entry)
 * Sheet: BCWS_Data
 *
 * LockService is enabled to serialize requests and prevent Google Drive
 * concurrency issues ("Service error: Drive") when creating folders and files
 * during high user load.
 */

function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('BCWS_Data') || ss.insertSheet('BCWS_Data');

  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", error: "Invalid JSON payload." }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ─────────────────────────────────────────────
  // 1. Duplicate Detection — locked, fast, lightweight
  //    Hold the lock ONLY for this check, then release immediately.
  //    Drive uploads must NOT happen inside a lock — they are slow and
  //    cause all concurrent users to queue up, triggering "Service error: Drive".
  // ─────────────────────────────────────────────
  if (data.uuid) {
    const lock = LockService.getDocumentLock();
    try {
      lock.waitLock(15000);
      const existingData = sheet.getDataRange().getValues();
      const uuidColIndex = 54; // Column BC (0-indexed)
      for (var i = 1; i < existingData.length; i++) {
        if (existingData[i][uuidColIndex] &&
            existingData[i][uuidColIndex].toString().trim() === data.uuid.trim()) {
          lock.releaseLock();
          return ContentService
            .createTextOutput(JSON.stringify({ status: "success", duplicate: true }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
    } catch (lockError) {
      // If we can't get the lock, proceed anyway — the UUID index will catch true duplicates
      console.warn("UUID check lock timed out:", lockError.toString());
    } finally {
      try { lock.releaseLock(); } catch (e) { /* already released */ }
    }
  }

  try {
    // ─────────────────────────────────────────────
    // 2. Google Drive Image Uploads
    //    Done OUTSIDE any lock — concurrent Drive writes are safe.
    //    Each user writes to their own uniquely-named file (timestamp + UUID).
    //    Retry with exponential backoff to handle transient "Service error: Drive".
    // ─────────────────────────────────────────────
    function getOrCreateFolder(parent, folderName, isRoot) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          let folders = isRoot
            ? DriveApp.getFoldersByName(folderName)
            : parent.getFoldersByName(folderName);
          if (folders.hasNext()) return folders.next();
          return isRoot
            ? DriveApp.createFolder(folderName)
            : parent.createFolder(folderName);
        } catch (driveErr) {
          if (attempt === 4) throw driveErr;
          Utilities.sleep(Math.min(1000 * Math.pow(2, attempt), 16000) + Math.random() * 2000);
        }
      }
    }

    const rootFolderName = "Participant_Snapshots";
    let rootFolder = getOrCreateFolder(null, rootFolderName, true);

    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const now = new Date();
    const monthFolderName = months[now.getMonth()] + '_' + now.getFullYear();
    let monthFolder = getOrCreateFolder(rootFolder, monthFolderName, false);

    const stateName = (data.state || 'Unknown_State').trim();
    let folder = getOrCreateFolder(monthFolder, stateName, false);

    const participantName = (data.name || 'Unknown').replace(/\s+/g, '_');
    // Use UUID suffix (first 8 chars) to guarantee unique filenames even if
    // two requests arrive at the same millisecond
    const uuidSuffix = data.uuid ? data.uuid.slice(0, 8) : Date.now().toString(36);

    function uploadImage(base64String, label) {
      if (!base64String || typeof base64String !== 'string' || base64String.trim() === '') {
        return { url: '', path: '' };
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const contentType = base64String.split(",")[0].split(":")[1].split(";")[0];
          const bytes = Utilities.base64Decode(base64String.split(",")[1]);
          const fileName = `${participantName}_${label}_${uuidSuffix}.jpg`;
          const blob = Utilities.newBlob(bytes, contentType, fileName);
          const file = folder.createFile(blob);
          const filePath = `${rootFolderName}/${monthFolderName}/${stateName}/${fileName}`;
          return { url: file.getUrl(), path: filePath };
        } catch (imgErr) {
          if (attempt === 3) return { url: `Upload Error: ${imgErr.message}`, path: '' };
          Utilities.sleep(Math.min(1000 * Math.pow(2, attempt), 8000) + Math.random() * 1000);
        }
      }
      return { url: '', path: '' };
    }

    const pretestResult  = uploadImage(data.image_pretest,  'PreTest');
    const posttestResult = uploadImage(data.image_posttest, 'PostTest');

    // ─────────────────────────────────────────────
    // 3. APPEND ROW — with a final UUID re-check inside a lock.
    //    WHY: Between step 1 (UUID check) and here, we spent 5-20s on Drive uploads.
    //    A concurrent request for the same UUID could have passed step 1 too and is
    //    about to appendRow simultaneously. The second lock + re-check closes this window.
    // ─────────────────────────────────────────────
    if (data.uuid) {
      const appendLock = LockService.getDocumentLock();
      try {
        appendLock.waitLock(20000);
        // Re-check UUID — another concurrent request may have appended it while we were uploading to Drive
        const freshData = sheet.getDataRange().getValues();
        const uuidColIndex = 54;
        for (var j = 1; j < freshData.length; j++) {
          if (freshData[j][uuidColIndex] &&
              freshData[j][uuidColIndex].toString().trim() === data.uuid.trim()) {
            appendLock.releaseLock();
            return ContentService
              .createTextOutput(JSON.stringify({ status: "success", duplicate: true }))
              .setMimeType(ContentService.MimeType.JSON);
          }
        }
        // UUID not found — safe to append. Do it inside the lock so we're atomic.
        sheet.appendRow([
      new Date(),                       // A: Timestamp

      // ── Metadata & Consent ──────────────────
      data.consent            || '',    // B: Participant Consent
      data.certificate_id     || '',    // C: Certificate ID
      data.post_test_score    || '',    // D: Post-Test Score
      data.inputted_by        || '',    // E: Inputted by - Batch of Entry
      data.jobberman_sst      || '',    // F: Do you have the Jobberman SST Certificate?

      // ── Learner's Biodata ───────────────────
      data.name               || '',    // G: Full Name
      data.email              || '',    // H: Email
      data.phone              || '',    // I: Phone Number
      data.phone_type         || '',    // J: Phone Number Type
      data.alt_phone          || '',    // K: Alternative Phone
      data.address            || '',    // L: Home Address
      data.gender             || '',    // M: Gender
      data.dob                || '',    // N: Date of Birth

      // ── Education & Employment ──────────────
      data.qualification      || '',    // O: Highest Qualification
      data.current_level      || '',    // P: Current Level (if Undergraduate)
      data.employment_status  || '',    // Q: Employment Status
      data.current_occupation || '',    // R: Current Occupation
      data.preferred_industry || '',    // S: Preferred Job Occupation or Industry
      data.preferred_job_role || '',    // T: Preferred Job Role
      data.top_skills         || '',    // U: Top 2-3 Skills
      data.income_range       || '',    // V: Income Range

      // ── Demographics & Background ───────────
      data.state              || '',    // W: State
      data.training_details   || '',    // X: Training Details (Institution|Partner|etc)
      data.settlement         || '',    // Y: Residential Settlement
      data.idp                || '',    // Z: Internally Displaced Person?
      data.disability         || '',    // AA: Any Form of Disability?
      data.disability_type    || '',    // AB: Disability Type

      // ── Business & Tech Access ──────────────
      data.existing_business  || '',    // AC: Do You Have an Existing Business?
      data.business_nature    || '',    // AD: Nature of the Business
      data.formal_training    || '',    // AE: Any Formal Training / Certification?
      data.tech_access        || '',    // AF: Access to Smartphone or Computer?
      data.internet_access    || '',    // AG: Internet Access at Home or Work?
      data.preferred_language || '',    // AH: Preferred Language for Follow-Up

      // ── Training & Job Search ───────────────
      data.prev_soft_skills   || '',    // AI: Prev. Soft Skills Training?
      data.training_reason    || '',    // AJ: Why do you want this training?
      data.confidence_level   || '',    // AK: Confidence in Current Soft Skills
      data.job_search_duration|| '',    // AL: How long actively job seeking?
      data.job_search_challenge|| '',   // AM: Biggest job search challenge
      data.desired_outcome    || '',    // AN: Most important training outcome
      data.has_cv             || '',    // AO: Do you have a CV/Resume?

      // ── Feedback ────────────────────────────
      data.hall_rating          || '',  // AP: Hall Conduciveness Rating
      data.facilities_adequate  || '',  // AQ: Facilities Adequate?
      data.ref_biscuit          || '',  // AR: Refreshment - Biscuit
      data.ref_drink            || '',  // AS: Refreshment - Drink
      data.ref_water            || '',  // AT: Refreshment - Water
      data.refreshment_satisfaction || '', // AU: Satisfied with Refreshments?
      data.refreshment_enhanced || '',  // AV: Refreshments Enhanced Training?
      data.facilitator_rating   || '',  // AW: Facilitator Performance Rating

      // ── Snapshots ───────────────────────────
      pretestResult.url,                // AX: Snapshot of PreTest Script (URL)
      pretestResult.path,               // AY: PreTest PathName
      posttestResult.url,               // AZ: Snapshot of PostTest Script (URL)
      posttestResult.path,              // BA: PostTest PathName

      // ── Duplicate Flag ──────────────────────
      data.is_duplicate       || '',    // BB: Is this a duplicate?

      // ── Submission UUID (offline-first tracking) ──
      data.uuid               || '',    // BC: Submission UUID
    ]);

        SpreadsheetApp.flush();
      } catch (appendErr) {
        throw appendErr; // Re-throw so outer catch can log it
      } finally {
        try { appendLock.releaseLock(); } catch (e) { /* already released */ }
      }
    } else {
      // No UUID (legacy entry) — append without lock
      sheet.appendRow([
        new Date(),
        data.consent || '', data.certificate_id || '', data.post_test_score || '',
        data.inputted_by || '', data.jobberman_sst || '', data.name || '',
        data.email || '', data.phone || '', data.phone_type || '', data.alt_phone || '',
        data.address || '', data.gender || '', data.dob || '', data.qualification || '',
        data.current_level || '', data.employment_status || '', data.current_occupation || '',
        data.preferred_industry || '', data.preferred_job_role || '', data.top_skills || '',
        data.income_range || '', data.state || '', data.training_details || '',
        data.settlement || '', data.idp || '', data.disability || '', data.disability_type || '',
        data.existing_business || '', data.business_nature || '', data.formal_training || '',
        data.tech_access || '', data.internet_access || '', data.preferred_language || '',
        data.prev_soft_skills || '', data.training_reason || '', data.confidence_level || '',
        data.job_search_duration || '', data.job_search_challenge || '', data.desired_outcome || '',
        data.has_cv || '', data.hall_rating || '', data.facilities_adequate || '',
        data.ref_biscuit || '', data.ref_drink || '', data.ref_water || '',
        data.refreshment_satisfaction || '', data.refreshment_enhanced || '',
        data.facilitator_rating || '', pretestResult.url, pretestResult.path,
        posttestResult.url, posttestResult.path, data.is_duplicate || '', ''
      ]);
      SpreadsheetApp.flush();
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // Log errors to a separate 'Errors' sheet for debugging
    const errSheet = ss.getSheetByName('Errors') || ss.insertSheet('Errors');

    let errorPayload = e.postData && e.postData.contents ? e.postData.contents : "";
    try {
      let parsedPayload = JSON.parse(errorPayload);
      delete parsedPayload.image_pretest;
      delete parsedPayload.image_posttest;
      errorPayload = JSON.stringify(parsedPayload);
    } catch (parseErr) { /* leave as-is */ }

    errSheet.appendRow([new Date(), err.toString(), errorPayload]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


/**
 * Handles GET requests.
 * ?action=getDynamicFields → returns DynamicFields sheet data as JSON
 *   Structure: { "StateName": { "InputtedByName": ["Institution1", ...] }, ... }
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'verify') {
    var uuid = (e.parameter.uuid || '').trim();
    if (!uuid) {
      return ContentService
        .createTextOutput(JSON.stringify({ found: false, error: 'No UUID provided' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('BCWS_Data');
    if (!sheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ found: false, error: 'Sheet not found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // BC column (index 54, 0-based) contains the UUID
    var data = sheet.getDataRange().getValues();
    var uuidColIndex = 54; // Column BC (0-indexed)
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][uuidColIndex] && data[i][uuidColIndex].toString().trim() === uuid) {
        found = true;
        break;
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ found: found }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getDynamicFields') {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DynamicFields');

    if (!sheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: 'DynamicFields sheet not found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var rows   = sheet.getDataRange().getValues();
    var result = {};

    // Row 0 = header row, skip it
    for (var i = 1; i < rows.length; i++) {
      var state       = (rows[i][0] || '').toString().trim();  // Col A
      var inputtedBy  = (rows[i][1] || '').toString().trim();  // Col B
      var institution = (rows[i][2] || '').toString().trim();  // Col C

      if (!state) continue;

      if (!result[state]) result[state] = {};
      if (!result[state][inputtedBy]) result[state][inputtedBy] = [];

      if (institution && result[state][inputtedBy].indexOf(institution) === -1) {
        result[state][inputtedBy].push(institution);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return HtmlService.createHtmlOutput('Jobberman BCWS Data Entry API is running.');
}