const axios = require('axios');
const { getValidAccessToken } = require('../../supbase'); // unified helper

console.log("📅 bookAppointment function - updated 2025-08-22 12:45 UTC");

exports.handler = async function (event) {
  try {
    const accessToken = await getValidAccessToken();

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Access token missing' })
      };
    }

    const params = event.queryStringParameters || {};
    const { contactId, calendarId, assignedUserId, startTime, endTime } = params;

    // ✅ Validate required parameters
    if (!contactId || !calendarId || !startTime || !endTime) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error: 'Missing required parameters: contactId, calendarId, startTime, endTime'
        })
      };
    }

    // Base payload
    const payload = {
      title: "Booking from Restyle website",
      meetingLocationType: "custom",
      meetingLocationId: "custom_0",
      overrideLocationConfig: true,
      appointmentStatus: "confirmed",
      address: "Zoom",
      ignoreDateRange: true,
      toNotify: true,
      ignoreFreeSlotValidation: true,
      calendarId,
      locationId: "7LYI93XFo8j4nZfswlaz", // 🔒 Hardcoded locationId
      contactId,
      startTime,
      endTime
    };

    // Only add assignedUserId if provided
    if (assignedUserId) {
      payload.assignedUserId = assignedUserId;
    }

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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: '✅ Booking success',
        response: response.data
      })
    };

  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    console.error('❌ Booking failed:', message);

    return {
      statusCode: status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Booking failed',
        details: message
      })
    };
  }
};
