const axios = require('axios');
const fs = require('fs');
const path = require('path');

const tokenPath = path.join(__dirname, 'tokens.json');
const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
const accessToken = tokenData.access_token;

// 🔁 Use a valid slot from your available slots
const startTime = '2025-07-23T12:30:00-07:00'; // ⏰ Customize this
const endTime   = '2025-07-23T13:00:00-07:00'; // ⏰ 30 mins or as per your duration

const payload = {
  title: "Booking from Restyle website",
  meetingLocationType: "custom",
  meetingLocationId: "custom_0",  // taken from locationConfigurations in your data
  overrideLocationConfig: true,
  appointmentStatus: "confirmed",
  assignedUserId: "6KcnWYemaXKvfeFCFdfn", // ✅ real staff userId
  address: "Zoom", // optional but nice for context
  ignoreDateRange: true,
  toNotify: true,
  ignoreFreeSlotValidation: true,
  calendarId: "woILyX2cMn3skq1MaTgL",
  locationId: "7LYI93XFo8j4nZfswlaz",
  contactId: "GmOVeNEBX2oOz3SchjlF",
  startTime,
  endTime
};

axios.post('https://services.leadconnectorhq.com/calendars/events/appointments', payload, {
  headers: {
    Authorization: `Bearer ${accessToken}`,
    Version: '2021-04-15',
    'Content-Type': 'application/json'
  }
})
.then(response => {
  console.log("✅ Booking successful:");
  console.log(response.data);
})
.catch(error => {
  console.error("❌ Booking failed:", error.response?.data || error.message);
});
