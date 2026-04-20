/**
 * Handles incoming data from the external HTML form (Jobberman SST Data Entry)
 * Sheet: BCWS_Data
 *
 * appendRow() is inherently atomic in Google Sheets, so no LockService
 * is needed. UUID-based duplicate detection prevents re-writes when
 * clients retry. LockService was removed to avoid quota errors
 * ("too many LockService operations") under high concurrency (200+ users).
 */

function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('BCWS_Data') || ss.insertSheet('BCWS_Data');

  try {
    // 1. Parse the JSON payload from the external site
    const data = JSON.parse(e.postData.contents);

    // ─────────────────────────────────────────────
    // 1.5. Duplicate Detection — check UUID before doing any work
    //      Prevents re-writing the same submission if client retries
    // ─────────────────────────────────────────────
    if (data.uuid) {
      const existingData = sheet.getDataRange().getValues();
      const uuidColIndex = 54; // Column BC (0-indexed)
      for (var i = 1; i < existingData.length; i++) {
        if (existingData[i][uuidColIndex] &&
            existingData[i][uuidColIndex].toString().trim() === data.uuid.trim()) {
          // Already exists — return success without re-writing
          return ContentService
            .createTextOutput(JSON.stringify({ status: "success", duplicate: true }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
    }

    // ─────────────────────────────────────────────
    // 2. Google Drive Image Uploads (PreTest & PostTest)
    //    Done OUTSIDE the lock — Drive writes don't conflict with Sheet writes
    // ─────────────────────────────────────────────
    // Root folder
    const rootFolderName = "Participant_Snapshots";
    let rootFolders = DriveApp.getFoldersByName(rootFolderName);
    let rootFolder = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder(rootFolderName);

    // Month subfolder (e.g. "March_2026")
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const now = new Date();
    const monthFolderName = months[now.getMonth()] + '_' + now.getFullYear();
    let monthFolders = rootFolder.getFoldersByName(monthFolderName);
    let monthFolder = monthFolders.hasNext() ? monthFolders.next() : rootFolder.createFolder(monthFolderName);

    // State subfolder (e.g. "Kano")
    const stateName = (data.state || 'Unknown_State').trim();
    let stateFolders = monthFolder.getFoldersByName(stateName);
    let folder = stateFolders.hasNext() ? stateFolders.next() : monthFolder.createFolder(stateName);

    const participantName = (data.name || 'Unknown').replace(/\s+/g, '_');
    const timestamp = new Date().getTime();

    function uploadImage(base64String, label) {
      if (!base64String || base64String.trim() === '') return { url: '', path: '' };
      try {
        const contentType = base64String.split(",")[0].split(":")[1].split(";")[0];
        const bytes = Utilities.base64Decode(base64String.split(",")[1]);
        const fileName = `${participantName}_${label}_${timestamp}.jpg`;
        const blob = Utilities.newBlob(bytes, contentType, fileName);
        const file = folder.createFile(blob);
        const filePath = `${rootFolderName}/${monthFolderName}/${stateName}/${fileName}`;
        return { url: file.getUrl(), path: filePath };
      } catch (imgErr) {
        return { url: `Upload Error: ${imgErr.message}`, path: '' };
      }
    }

    const pretestResult  = uploadImage(data.image_pretest,  'PreTest');
    const posttestResult = uploadImage(data.image_posttest, 'PostTest');

    // ─────────────────────────────────────────────
    // 3. APPEND ROW — No LockService needed!
    //    appendRow() is inherently atomic in Google Sheets.
    //    UUID-based duplicate detection (step 1.5) handles idempotency.
    //    Removing LockService avoids "too many LockService operations" quota errors
    //    when 200+ users upload concurrently.
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

    // Flush changes to ensure the write is committed before returning
    SpreadsheetApp.flush();

    return ContentService
      .createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // Log errors to a separate 'Errors' sheet for debugging
    const errSheet = ss.getSheetByName('Errors') || ss.insertSheet('Errors');
    errSheet.appendRow([new Date(), err.toString(), e.postData.contents]);

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