const axios = require('axios');
const { getValidAccessToken } = require('../../supbase');
const { getCache, setCache } = require('../../supbaseCache');

// 🔄 Retry helper
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

    const { calendarId = 'woILyX2cMn3skq1MaTgL', userId } = event.queryStringParameters || {};

    // 🔹 Helpers
    const fetchSlots = async (start, end) => {
      let url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}`;
      if (userId) url += `&userId=${userId}`;
      const response = await fetchWithRetry(url, {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-04-15'
      });
      return response.data;
    };

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

    const getDayRange = (day) => ({
      start: new Date(day.setHours(0, 0, 0, 0)).getTime(),
      end: new Date(day.setHours(23, 59, 59, 999)).getTime()
    });

    // ✅ Loop for 7 days (today + next 6 days)
    const weeklySlots = {};
    for (let i = 0; i < 7; i++) {
      const day = new Date();
      day.setDate(day.getDate() + i);
      const { start, end } = getDayRange(new Date(day));

      const cacheKey = `weekly:${calendarId}:${userId || 'all'}:${start}:${end}`;
      let dayData = await getCache(cacheKey, 10);

      if (!dayData) {
        const fetched = await fetchSlots(start, end);
        const formatted = formatSlots(fetched);
        dayData = { date: day.toDateString(), slots: formatted };
        await setCache(cacheKey, dayData, 10);
      }

      weeklySlots[day.toDateString()] = dayData.slots;
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ calendarId, range: '7days', slots: weeklySlots })
    };

  } catch (err) {
    console.error('❌ Error in WeeklySlots:', err.response?.data || err.message);
    return {
      statusCode: err.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to fetch weekly slots', details: err.response?.data || err.message })
    };
  }
};
