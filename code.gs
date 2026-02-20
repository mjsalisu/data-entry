/**
 * Handles incoming data from the external HTML form (Jobberman SST Data Entry)
 * Sheet: Data_Q4
 */
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Data_Q4') || ss.insertSheet('Data_Q4');

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
    // 3. Append Row to Google Sheet (Data_Q4)
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
      data.location           || '',    // V: Location
      data.training_details   || '',    // W: Training Details
      data.settlement         || '',    // X: Residential Settlement
      data.idp                || '',    // Y: Internally Displaced Person?
      data.disability         || '',    // Z: Any Form of Disability?
      data.disability_type    || '',    // AA: Disability Type

      // ── Business & Tech Access ──────────────
      data.existing_business  || '',    // AB: Do You Have an Existing Business?
      data.business_nature    || '',    // AC: Nature of the Business
      data.formal_training    || '',    // AD: Any Formal Training / Certification?
      data.tech_access        || '',    // AE: Access to Smartphone or Computer?
      data.internet_access    || '',    // AF: Internet Access at Home or Work?
      data.preferred_language || '',    // AG: Preferred Language for Follow-Up

      // ── Training & Job Search ───────────────
      data.prev_soft_skills   || '',    // AH: Prev. Soft Skills Training?
      data.training_reason    || '',    // AI: Why do you want this training?
      data.confidence_level   || '',    // AJ: Confidence in Current Soft Skills
      data.job_search_duration|| '',    // AK: How long actively job seeking?
      data.job_search_challenge|| '',   // AL: Biggest job search challenge
      data.desired_outcome    || '',    // AM: Most important training outcome
      data.has_cv             || '',    // AN: Do you have a CV/Resume?

      // ── Feedback ────────────────────────────
      data.hall_rating          || '',  // AO: Hall Conduciveness Rating (1–5)
      data.facilities_adequate  || '',  // AP: Facilities Adequate?
      data.refreshments         || '',  // AQ: Refreshments Served
      data.refreshment_satisfaction || '', // AR: Satisfied with Refreshments?
      data.refreshment_enhanced || '',  // AS: Refreshments Enhanced Training?
      data.facilitator_rating   || '',  // AT: Facilitator Performance Rating (1–5)

      // ── Snapshots ───────────────────────────
      pretestImageUrl,                  // AU: PreTest Script Image Link
      posttestImageUrl,                 // AV: PostTest Script Image Link

      // ── Duplicate Flag ──────────────────────
      data.is_duplicate       || '',    // AW: Is this a duplicate?
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

// Dummy doGet to allow the script to be deployed as a Web App
function doGet() {
  return HtmlService.createHtmlOutput("Jobberman SST Data Entry API is running.");
}