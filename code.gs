/***********************
 * CONFIG
 ***********************/
const GEMINI_API_KEY = 'AIzaSyDnvMPY3NhNQZozZINzrLua3U8ML6x0CuU';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const userPrompt = body.contents[0].parts[0].text;
    
    // QUAN TRỌNG: Lấy model từ client gửi lên. 
    // Nếu client không gửi, mặc định dùng 'gemini-1.5-flash'
    const modelName = body.model || 'gemini-1.5-flash'; 
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    
    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }]
      }),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(apiUrl, options);
    return ContentService.createTextOutput(response.getContentText())
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ 
        error: { message: err.toString(), code: 500 } 
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
