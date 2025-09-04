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

// 🔹 Business hours per weekday (0=Sun … 6=Sat)
const businessHours = {
  0: { start: "09:00", end: "19:00" }, // Sunday
  1: { start: "09:00", end: "19:00" }, // Monday
  2: { start: "09:00", end: "19:00" }, // Tuesday
  3: { start: "09:00", end: "19:00" }, // Wednesday
  4: { start: "11:00", end: "19:00" }, // Thursday
  5: { start: "09:00", end: "19:00" }, // Friday
  6: { start: "09:00", end: "19:00" }  // Saturday
};

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

    // 🔹 Helper: format slots (filter by business hours in MST)
    const formatSlots = (slotsData) => {
      const formatted = {};
      Object.entries(slotsData).forEach(([date, value]) => {
        if (date === 'traceId') return;
        if (!value.slots?.length) return;

        const day = new Date(date + "T00:00:00Z");
        const dayOfWeek = new Date(day.toLocaleString("en-US", { timeZone: "America/Edmonton" })).getDay();
        const hours = businessHours[dayOfWeek];
        if (!hours) return;

        const [startHour, startMinute] = hours.start.split(":").map(Number);
        const [endHour, endMinute] = hours.end.split(":").map(Number);

        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        const validSlots = value.slots.filter(slot => {
          const local = new Date(slot).toLocaleString("en-US", { timeZone: "America/Edmonton" });
          const d = new Date(local);
          const minutes = d.getHours() * 60 + d.getMinutes();
          return minutes >= startMinutes && minutes <= endMinutes;
        });

        if (validSlots.length) {
          formatted[date] = validSlots.map(slot =>
            new Date(slot).toLocaleString('en-US', {
              timeZone: 'America/Edmonton',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            })
          );
        }
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

    // ✅ Build next 30 calendar days (no skipping weekends)
    const daysToCheck = 30;
    const allDays = [];
    for (let i = 0; i < daysToCheck; i++) {
      const checkDate = new Date(startDate);
      checkDate.setDate(startDate.getDate() + i);
      allDays.push(checkDate);
    }

    const { start: startOfRange } = getDayRange(allDays[0]);
    const { end: endOfRange } = getDayRange(allDays[allDays.length - 1]);

    const cacheKey = `days30:${calendarId}:${userId || 'all'}:${startOfRange}:${endOfRange}`;

    // 1. Try cache
    const cached = await getCache(cacheKey, 30);
    if (cached) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(cached) };
    }

    // 2. Fetch slots
    const slotsData = await fetchSlots(startOfRange, endOfRange);
    const allFormatted = formatSlots(slotsData);

    // Filter only the selected 30 days
    const filtered = {};
    allDays.forEach(d => {
      const key = d.toISOString().split('T')[0];
      if (allFormatted[key]) {
        filtered[key] = allFormatted[key];
      }
    });

    const responseData = {
      calendarId,
      activeDay: '30days',
      startDate: startDate.toISOString().split('T')[0],
      slots: filtered
    };

    // 3. Cache result
    await setCache(cacheKey, responseData, 30);

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
