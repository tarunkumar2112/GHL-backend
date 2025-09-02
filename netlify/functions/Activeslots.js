const axios = require('axios');
const { getValidAccessToken } = require('../../supbase');
const { getCache, setCache } = require('../../supbaseCache'); // ✅ cache helpers

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
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Access token missing' }) };
    }

    const { calendarId = 'woILyX2cMn3skq1MaTgL', userId } = event.queryStringParameters || {};

    // 🔹 Helper: fetch slots
    const fetchSlots = async (start, end) => {
      let url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}`;
      if (userId) url += `&userId=${userId}`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Version: '2021-04-15' }
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

    // 🔹 Day ranges
    const getDayRange = (day) => ({
      start: new Date(day.setHours(0, 0, 0, 0)).getTime(),
      end: new Date(day.setHours(23, 59, 59, 999)).getTime()
    });

    // ✅ First try today
    const { start: todayStart, end: todayEnd } = getDayRange(new Date());
    const cacheKeyToday = `active:${calendarId}:${userId || 'all'}:${todayStart}:${todayEnd}`;

    // 1. Try cache for today
    const cachedToday = await getCache(cacheKeyToday, 2);
    if (cachedToday) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(cachedToday) };
    }

    const todayData = await fetchSlots(todayStart, todayEnd);
    const todayFormatted = formatSlots(todayData);

    if (Object.keys(todayFormatted).length > 0) {
      const responseData = { calendarId, activeDay: 'today', slots: todayFormatted };

      // Save cache
      await setCache(cacheKeyToday, responseData, 2);

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(responseData) };
    }

    // ✅ Fallback: tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { start: tomorrowStart, end: tomorrowEnd } = getDayRange(new Date(tomorrow));
    const cacheKeyTomorrow = `active:${calendarId}:${userId || 'all'}:${tomorrowStart}:${tomorrowEnd}`;

    const cachedTomorrow = await getCache(cacheKeyTomorrow, 2);
    if (cachedTomorrow) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(cachedTomorrow) };
    }

    const tomorrowData = await fetchSlots(tomorrowStart, tomorrowEnd);
    const tomorrowFormatted = formatSlots(tomorrowData);

    const responseData = { calendarId, activeDay: 'tomorrow', slots: tomorrowFormatted };

    await setCache(cacheKeyTomorrow, responseData, 2);

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(responseData) };

  } catch (err) {
    console.error('❌ Error in Activeslots:', err.response?.data || err.message);

    return {
      statusCode: err.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to fetch active slots', details: err.response?.data || err.message })
    };
  }
};
