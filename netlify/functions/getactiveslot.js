const axios = require('axios');
const { getStoredTokens } = require('../../token'); // Adjust if needed

exports.handler = async function (event) {
  // Handle CORS preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: ''
    };
  }

  try {
    const tokens = await getStoredTokens();
    const accessToken = tokens?.access_token;

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

    // Parse query params with default calendarId
    const { calendarId = 'woILyX2cMn3skq1MaTgL', userId } = event.queryStringParameters || {};

    // Helper: Fetch slots from API
    const fetchSlots = async (start, end) => {
      let url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
      if (userId) url += `&userId=${userId}`;

      const config = {
        method: 'get',
        url,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: '2021-04-15'
        }
      };

      const response = await axios(config);
      return response.data;
    };

    // Helper: Format slots to Mountain Time
    const formatSlots = (slotsData) => {
      const formatted = {};
      Object.entries(slotsData).forEach(([date, value]) => {
        if (date === 'traceId') return;
        if (!value.slots?.length) return;
        formatted[date] = value.slots.map(slot =>
          new Date(slot).toLocaleString('en-US', {
            timeZone: 'America/Denver',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          })
        );
      });
      return formatted;
    };

    // Get ISO date range for a specific day
    const getDayRange = (day) => ({
      start: new Date(day.setHours(0, 0, 0, 0)).toISOString(),
      end: new Date(day.setHours(23, 59, 59, 999)).toISOString()
    });

    // Today
    const { start: todayStart, end: todayEnd } = getDayRange(new Date());
    const todayData = await fetchSlots(todayStart, todayEnd);
    const todayFormatted = formatSlots(todayData);

    if (Object.keys(todayFormatted).length > 0) {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          calendarId,
          activeDay: 'today',
          slots: todayFormatted
        })
      };
    }

    // Tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { start: tomorrowStart, end: tomorrowEnd } = getDayRange(new Date(tomorrow));
    const tomorrowData = await fetchSlots(tomorrowStart, tomorrowEnd);
    const tomorrowFormatted = formatSlots(tomorrowData);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        calendarId,
        activeDay: 'tomorrow',
        slots: tomorrowFormatted
      })
    };

  } catch (err) {
    console.error('❌ Error in getAllStaffSlot:', err.response?.data || err.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Failed to fetch active slots' })
    };
  }
};
