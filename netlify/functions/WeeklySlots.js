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

    const { calendarId = 'woILyX2cMn3skq1MaTgL', userId, weekOffset = 0 } = event.queryStringParameters || {};

    // 🔹 Helper: Get week range (Monday to Sunday)
    const getWeekRange = (weekOffset = 0) => {
      const today = new Date();
      const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday
      
      // Calculate Monday of current week
      const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
      const monday = new Date(today);
      monday.setDate(today.getDate() + mondayOffset + (weekOffset * 7));
      monday.setHours(0, 0, 0, 0);
      
      // Calculate Sunday of current week
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);
      
      return {
        start: monday.getTime(),
        end: sunday.getTime(),
        monday: monday.toISOString().split('T')[0],
        sunday: sunday.toISOString().split('T')[0]
      };
    };

    // 🔹 Get week range
    const { start, end, monday, sunday } = getWeekRange(parseInt(weekOffset));
    
    // 🔹 Cache key
    const cacheKey = `weekly:${calendarId}:${monday}:${sunday}:${userId || 'all'}`;

    // 1. Try cache first (30 min TTL for weekly data)
    const cached = await getCache(cacheKey, 30);
    if (cached) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(cached) };
    }

    // 2. API call with retry
    const baseUrl = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots`;
    const params = new URLSearchParams({ 
      startDate: start.toString(), 
      endDate: end.toString() 
    });
    if (userId) params.append('userId', userId);

    const fullUrl = `${baseUrl}?${params.toString()}`;

    const response = await fetchWithRetry(fullUrl, {
      Authorization: `Bearer ${accessToken}`,
      Version: '2021-04-15'
    });

    const slotsData = response.data;

    // 🕒 Format slots to Mountain Time (same as other functions)
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

    const responseData = { 
      calendarId, 
      weekRange: { monday, sunday },
      weekOffset: parseInt(weekOffset),
      totalDays: 7,
      slots: formattedSlots,
      rawData: slotsData // 🔹 Original API response without filtering
    };

    // 3. Save in cache (30 min TTL)
    await setCache(cacheKey, responseData, 30);

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(responseData) };

  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    console.error('❌ Error fetching weekly slots:', message);

    return {
      statusCode: status,
      headers: corsHeaders,
      body: JSON.stringify({ error: message })
    };
  }
};
