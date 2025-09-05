const axios = require('axios');
const { getValidAccessToken } = require('../../supbase');

// 🔄 Retry helper for 429 Too Many Requests
async function fetchWithRetry(url, headers, retries = 3, delay = 500) {
  try {
    return await axios.get(url, { headers });
  } catch (err) {
    if (err.response?.status === 429 && retries > 0) {
      console.warn(`429 received, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, headers, retries - 1, delay * 2);
    }
    throw err;
  }
}

exports.handler = async function (event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  // ✅ Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Access token missing' })
      };
    }

    const { calendarId, userId, date } = event.queryStringParameters || {};
    if (!calendarId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'calendarId parameter is required' })
      };
    }

    // 🔹 Helper: fetch slots with retry
    const fetchSlots = async (start, end) => {
      let url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}`;
      if (userId) url += `&userId=${userId}`;

      const response = await fetchWithRetry(url, {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-04-15'
      });
      return response.data;
    };

    // 🔹 Helper: format slots (MST/MDT)
    const formatSlots = (slotsData) => {
      const formatted = {};
      Object.entries(slotsData).forEach(([date, value]) => {
        if (date === 'traceId') return;
        if (!value.slots?.length) return;
        formatted[date] = value.slots.map(slot =>
          new Date(slot).toLocaleString('en-US', {
            timeZone: 'America/Denver', // Mountain Time
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          })
        );
      });
      return formatted;
    };

    // 🔹 Helper: start/end of day
    const getDayRange = (day) => ({
      start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).getTime(),
      end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).getTime()
    });

    // ✅ Start date: either ?date or today
    let startDate = new Date();
    if (date) {
      const parts = date.split('-');
      if (parts.length === 3) {
        startDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      }
    }

    // ✅ Build next 30 days including weekends
    const totalDays = 30;
    const daysToCheck = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      daysToCheck.push(d);
    }

    const { start: startOfRange } = getDayRange(daysToCheck[0]);
    const { end: endOfRange } = getDayRange(daysToCheck[daysToCheck.length - 1]);

    // Fetch slots
    const slotsData = await fetchSlots(startOfRange, endOfRange);
    const allFormatted = formatSlots(slotsData);

    // Filter only the selected days
    const filtered = {};
    daysToCheck.forEach(d => {
      const key = d.toISOString().split('T')[0];
      if (allFormatted[key]) {
        filtered[key] = allFormatted[key];
      }
    });

    const responseData = {
      calendarId,
      activeDay: 'allDays',
      startDate: startDate.toISOString().split('T')[0],
      slots: filtered
    };

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(responseData) };

  } catch (err) {
    console.error('❌ Error in WorkingSlots:', err.response?.data || err.message);
    return {
      statusCode: err.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to fetch working slots',
        details: err.response?.data || err.message
      })
    };
  }
};
