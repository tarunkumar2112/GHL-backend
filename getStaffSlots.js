const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 🔐 Load Access Token
const tokenPath = path.join(__dirname, 'tokens.json');
const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
const accessToken = tokenData.access_token;

// 📅 Define calendarId and date range
const calendarId = 'woILyX2cMn3skq1MaTgL';
const startDate = new Date(); // today
const endDate = new Date();
endDate.setDate(startDate.getDate() + 2); // next 2 days

// Convert to timestamps
const startTimestamp = startDate.setHours(0, 0, 0, 0);
const endTimestamp = endDate.setHours(23, 59, 59, 999);

// 🔁 API Config
const config = {
  method: 'get',
  url: `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${startTimestamp}&endDate=${endTimestamp}`,
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Version': '2021-04-15'
  }
};

// 📞 Fetch available slots
axios.request(config)
  .then(response => {
    const slots = response.data;
    console.log(`📅 Available slots for calendar: ${calendarId}\n`);

    Object.entries(slots).forEach(([date, obj]) => {
      if (date === 'traceId') return;
      console.log(`📆 ${date}`);
      obj.slots.forEach(slot => {
        const time = new Date(slot).toLocaleTimeString('en-US', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
        });
        console.log(`   ⏰ ${time}`);
      });
    });
  })
  .catch(error => {
    console.error('❌ Error:', error.response?.data || error.message);
  });
