const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Step 1: Load access token from tokens.json
const tokenPath = path.join(__dirname, 'tokens.json');
const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
const accessToken = tokenData.access_token;

// Step 2: Axios config with token
let config = {
  method: 'get',
  maxBodyLength: Infinity,
  url: 'https://services.leadconnectorhq.com/calendars/?groupId=HOtwCH6rCz43svmU5X3M&locationId=7LYI93XFo8j4nZfswlaz',
  headers: { 
    'Authorization': `Bearer ${accessToken}`, 
    'Version': '2021-04-15'
  }
};

// Step 3: Send API request
axios.request(config)
.then((response) => {
  console.log("✅ Gents Calendar Response:");
  console.log(JSON.stringify(response.data, null, 2));
})
.catch((error) => {
  console.log("❌ Error:", error.response?.data || error.message);
});
