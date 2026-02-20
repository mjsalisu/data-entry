/**
 * Handles incoming data from your external HTML form
 */
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Data') || ss.insertSheet('Data');
  
  try {
    // 1. Parse the JSON payload from the external site
    const data = JSON.parse(e.postData.contents);
    
    // 2. Handle Google Drive Image Upload
    const folderName = "Participant_Snapshots";
    let folders = DriveApp.getFoldersByName(folderName);
    let folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

    // Process the Base64 image string
    const contentType = data.image.split(",")[0].split(":")[1].split(";")[0];
    const bytes = Utilities.base64Decode(data.image.split(",")[1]);
    const fileName = data.name.replace(/\s+/g, '_') + "_" + new Date().getTime() + ".jpg";
    const blob = Utilities.newBlob(bytes, contentType, fileName);
    const file = folder.createFile(blob);
    
    // Make file viewable so you can click the link in the sheet
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // 3. Append Row to Google Sheet
    sheet.appendRow([
      new Date(),       // Timestamp
      data.name, 
      data.email, 
      data.phone, 
      data.gender, 
      data.dob, 
      data.address, 
      data.state, 
      data.location, 
      data.recordedBy, 
      file.getUrl()     // Link to the photo
    ]);

    // Return success response
    return ContentService.createTextOutput(JSON.stringify({"status": "success"}))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // Log errors to a separate sheet called 'Errors' for debugging
    const errSheet = ss.getSheetByName('Errors') || ss.insertSheet('Errors');
    errSheet.appendRow([new Date(), err.toString(), e.postData.contents]);
    
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "error": err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Dummy doGet to allow the script to be deployed as a Web App
function doGet() {
  return HtmlService.createHtmlOutput("Backend API is running.");
}