const axios = require('axios');
const { getValidAccessToken } = require('../../supbase');
const { getCache, setCache } = require('../../supbaseCache');

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

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const accessToken = await getValidAccessToken();

    if (!accessToken) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Access token missing' }) };
    }

    const { calendarId, userId, date } = event.queryStringParameters || {};

    if (!calendarId) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'calendarId parameter is required' }) };
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

    // 🔹 Helper: format slots
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

    // 🔹 Helper: start/end of day
    const getDayRange = (day) => ({
      start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).getTime(),
      end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).getTime()
    });

    // ✅ Use ?date=YYYY-MM-DD or default to today
    let startDateObj;
    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      startDateObj = new Date(y, m - 1, d);
    } else {
      startDateObj = new Date();
    }

    const { start: startOfWeek } = getDayRange(startDateObj);

    const endOfWeek = new Date(startDateObj);
    endOfWeek.setDate(startDateObj.getDate() + 6); // 7 days
    const { end: endOfWeekTime } = getDayRange(endOfWeek);

    const cacheKeyWeek = `weekly:${calendarId}:${userId || 'all'}:${startOfWeek}:${endOfWeekTime}`;

    // 1. Try cache for the week
    const cachedWeek = await getCache(cacheKeyWeek, 30);
    if (cachedWeek) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(cachedWeek) };
    }

    // 2. Fetch weekly data
    const weekData = await fetchSlots(startOfWeek, endOfWeekTime);
    const weekFormatted = formatSlots(weekData);

    const responseData = { 
      calendarId, 
      activeDay: 'week', 
      startDate: date || new Date().toISOString().split('T')[0], 
      slots: weekFormatted 
    };

    // 3. Cache result
    await setCache(cacheKeyWeek, responseData, 30);

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(responseData) };

  } catch (err) {
    console.error('❌ Error in WeeklySlots:', err.response?.data || err.message);

    return {
      statusCode: err.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to fetch weekly slots', details: err.response?.data || err.message })
    };
  }
};
