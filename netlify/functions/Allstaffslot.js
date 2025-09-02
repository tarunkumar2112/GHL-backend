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
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Access token missing' })
      };
    }

    const { calendarId, startDate, endDate, userId } = event.queryStringParameters || {};

    // ✅ Required parameters check
    if (!calendarId || !startDate || !endDate) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Missing required query parameters: calendarId, startDate, endDate.'
        })
      };
    }

    // 🔹 Cache key
    const cacheKey = `allstaff:${calendarId}:${startDate}:${endDate}:${userId || 'all'}`;

    // 1. Try cache first
    const cached = await getCache(cacheKey, 5);
    if (cached) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(cached) };
    }

    // 2. API call if no cache
    const baseUrl = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots`;
    const params = new URLSearchParams({ startDate, endDate });
    if (userId) params.append('userId', userId);

    const fullUrl = `${baseUrl}?${params.toString()}`;

    const response = await axios.get(fullUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Version: '2021-04-15' }
    });

    const slotsData = response.data;

    // 🕒 Format slots to Mountain Time
    const formattedSlots = {};
    Object.entries(slotsData).forEach(([date, value]) => {
      if (date === 'traceId') return;
      formattedSlots[date] = value.slots.map(slot =>
        new Date(slot).toLocaleString('en-US', {
          timeZone: 'America/Denver',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        })
      );
    });

    const responseData = { calendarId, formattedSlots };

    // 3. Save in cache
    await setCache(cacheKey, responseData, 5);

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(responseData) };

  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    console.error('❌ Error fetching slots:', message);

    return {
      statusCode: status,
      headers: corsHeaders,
      body: JSON.stringify({ error: message })
    };
  }
};
