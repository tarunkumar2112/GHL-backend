const axios = require('axios');
const { getStoredTokens, refreshAccessToken } = require('../../token'); // Adjust path if needed

exports.handler = async function (event) {
  try {
    // 🌟 Refresh & fetch the latest tokens
    await refreshAccessToken();
    const tokens = await getStoredTokens();
    const accessToken = tokens?.access_token;

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Access token missing' })
      };
    }

    // 🧩 Hardcoded booking details (You can make these dynamic later)
    const startTime = '2025-07-23T12:30:00-07:00';
    const endTime = '2025-07-23T13:00:00-07:00';

    const payload = {
      title: "Booking from Restyle website",
      meetingLocationType: "custom",
      meetingLocationId: "custom_0",
      overrideLocationConfig: true,
      appointmentStatus: "confirmed",
      assignedUserId: "6KcnWYemaXKvfeFCFdfn",
      address: "Zoom",
      ignoreDateRange: true,
      toNotify: true,
      ignoreFreeSlotValidation: true,
      calendarId: "woILyX2cMn3skq1MaTgL",
      locationId: "7LYI93XFo8j4nZfswlaz",
      contactId: "Tf6JwAYxUur17GWtB81V",
      startTime,
      endTime
    };

    const response = await axios.post(
      'https://services.leadconnectorhq.com/calendars/events/appointments',
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: '2021-04-15',
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '✅ Booking success', response: response.data })
    };

  } catch (err) {
    console.error('❌ Booking failed:', err.response?.data || err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Booking failed', details: err.response?.data || err.message })
    };
  }
};
