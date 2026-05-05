/**
 * Handles incoming data from the external HTML form (Jobberman SST Data Entry)
 * Sheet: BCWS_Data
 *
 * LOCK-FREE DESIGN: LockService is intentionally NOT used.
 * At 200+ concurrent users, any waitLock() call queues all requests and causes
 * "Lock timeout" errors — losing submitted records entirely.
 * Instead: appendRow() is atomic in Google Sheets, Drive files use UUID-based
 * unique names, and duplicate prevention is handled client-side + via UUID check.
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
  // 1. UUID Duplicate Check — lock-free, best-effort early exit.
  //
  //    WHY NO LOCK:
  //    With 200+ concurrent users, LockService.waitLock() queues all requests.
  //    Each request holds the lock for ~1-2s (sheet scan). With 50 concurrent
  //    requests, the 16th request waits 15+ seconds and throws "Lock timeout" —
  //    causing the entire submission to fail and the record to be LOST.
  //
  //    This check is a fast-path optimization, NOT the sole safety net.
  //    True duplicate prevention relies on:
  //      a) Client-side: unique UUIDs, session tokens, only-pending queue
  //      b) Server-side: appendRow writes the UUID; the Verify action
  //         confirms it; re-submitted UUIDs will hit this check on retry
  //
  //    Risk of skipping the lock: two concurrent requests with the SAME uuid
  //    could both pass this check. This is extremely rare after client fixes,
  //    and a duplicate row is far better than a lost record.
  // ─────────────────────────────────────────────
  if (data.uuid) {
    try {
      const existingData = sheet.getDataRange().getValues();
      const uuidColIndex = 54; // Column BC (0-indexed)
      for (var i = 1; i < existingData.length; i++) {
        if (existingData[i][uuidColIndex] &&
            existingData[i][uuidColIndex].toString().trim() === data.uuid.trim()) {
          return ContentService
            .createTextOutput(JSON.stringify({ status: "success", duplicate: true }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
    } catch (checkErr) {
      // Non-fatal: if the check fails, proceed to write the record anyway
      console.warn("UUID pre-check failed (non-fatal):", checkErr.toString());
    }
  }

  try {
    // ─────────────────────────────────────────────
    // 2. Google Drive Image Uploads — fully concurrent, no lock needed.
    //    Each file has a UUID-based unique name so parallel writes never collide.
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
    // 3. APPEND ROW — no lock needed.
    //    Google Sheets serializes concurrent appendRow() calls internally.
    //    Holding a lock here at 200+ concurrency caused ALL the "Lock timeout"
    //    errors and lost records. appendRow() is already atomic.
    // ─────────────────────────────────────────────
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