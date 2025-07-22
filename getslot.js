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
  url: 'https://services.leadconnectorhq.com/calendars/1g7WSCXH70nWZ9r8vw2L/free-slots?startDate=1753228800000&endDate=1753315199999',
  headers: { 
    'Authorization': `Bearer ${accessToken}`, 
    'Version': '2021-04-15'
  }
};

// Step 3: Make API call
axios.request(config)
.then((response) => {
  console.log("✅ Free Slots Response:");
  console.log(JSON.stringify(response.data, null, 2));
})
.catch((error) => {
  console.log("❌ Error:", error.response?.data || error.message);
});
