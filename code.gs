/**
 * Handles incoming data from the external HTML form (Jobberman SST Data Entry)
 * Sheet: BCWS_Data
 */
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('BCWS_Data') || ss.insertSheet('BCWS_Data');

  try {
    // 1. Parse the JSON payload from the external site
    const data = JSON.parse(e.postData.contents);

    // ─────────────────────────────────────────────
    // 2. Google Drive Image Uploads (PreTest & PostTest)
    // ─────────────────────────────────────────────
    const folderName = "Participant_Snapshots";
    let folders = DriveApp.getFoldersByName(folderName);
    let folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

    const participantName = (data.name || 'Unknown').replace(/\s+/g, '_');
    const timestamp = new Date().getTime();

    function uploadImage(base64String, label) {
      if (!base64String || base64String.trim() === '') return '';
      try {
        const contentType = base64String.split(",")[0].split(":")[1].split(";")[0];
        const bytes = Utilities.base64Decode(base64String.split(",")[1]);
        const fileName = `${participantName}_${label}_${timestamp}.jpg`;
        const blob = Utilities.newBlob(bytes, contentType, fileName);
        const file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        return file.getUrl();
      } catch (imgErr) {
        return `Upload Error: ${imgErr.message}`;
      }
    }

    const pretestImageUrl  = uploadImage(data.image_pretest,  'PreTest');
    const posttestImageUrl = uploadImage(data.image_posttest, 'PostTest');

    // ─────────────────────────────────────────────
    // 3. Append Row to Google Sheet (BCWS_Data)
    //    Column order matches the headers visible in the sheet screenshot.
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
      data.address            || '',    // K: Home Address
      data.gender             || '',    // L: Gender
      data.dob                || '',    // M: Date of Birth

      // ── Education & Employment ──────────────
      data.qualification      || '',    // N: Highest Qualification
      data.current_level      || '',    // O: Current Level (if Undergraduate)
      data.employment_status  || '',    // P: Employment Status
      data.current_occupation || '',    // Q: Current Occupation
      data.preferred_industry || '',    // R: Preferred Job Occupation or Industry
      data.top_skills         || '',    // S: Top 2-3 Skills
      data.income_range       || '',    // T: Income Range

      // ── Demographics & Background ───────────
      data.state              || '',    // U: State
      data.training_details   || '',    // V: Training Details (Institution|Partner|etc)
      data.settlement         || '',    // W: Residential Settlement
      data.idp                || '',    // X: Internally Displaced Person?
      data.disability         || '',    // Y: Any Form of Disability?
      data.disability_type    || '',    // Z: Disability Type

      // ── Business & Tech Access ──────────────
      data.existing_business  || '',    // AA: Do You Have an Existing Business?
      data.business_nature    || '',    // AB: Nature of the Business
      data.formal_training    || '',    // AC: Any Formal Training / Certification?
      data.tech_access        || '',    // AD: Access to Smartphone or Computer?
      data.internet_access    || '',    // AE: Internet Access at Home or Work?
      data.preferred_language || '',    // AF: Preferred Language for Follow-Up

      // ── Training & Job Search ───────────────
      data.prev_soft_skills   || '',    // AG: Prev. Soft Skills Training?
      data.training_reason    || '',    // AH: Why do you want this training?
      data.confidence_level   || '',    // AI: Confidence in Current Soft Skills
      data.job_search_duration|| '',    // AJ: How long actively job seeking?
      data.job_search_challenge|| '',   // AK: Biggest job search challenge
      data.desired_outcome    || '',    // AL: Most important training outcome
      data.has_cv             || '',    // AM: Do you have a CV/Resume?

      // ── Feedback ────────────────────────────
      data.hall_rating          || '',  // AN: Hall Conduciveness Rating
      data.facilities_adequate  || '',  // AO: Facilities Adequate?
      data.ref_biscuit          || '',  // AP: Refreshment - Biscuit
      data.ref_drink            || '',  // AQ: Refreshment - Drink
      data.ref_water            || '',  // AR: Refreshment - Water
      data.refreshment_satisfaction || '', // AS: Satisfied with Refreshments?
      data.refreshment_enhanced || '',  // AT: Refreshments Enhanced Training?
      data.facilitator_rating   || '',  // AU: Facilitator Performance Rating

      // ── Snapshots ───────────────────────────
      pretestImageUrl,                  // AV: PreTest Script Image Link
      posttestImageUrl,                 // AW: PostTest Script Image Link

      // ── Duplicate Flag ──────────────────────
      data.is_duplicate       || '',    // AX: Is this a duplicate?
    ]);

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

  return HtmlService.createHtmlOutput('Jobberman SST Data Entry API is running.');
}