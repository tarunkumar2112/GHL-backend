const axios = require('axios');
const { getValidAccessToken } = require('../../supbase'); 
const { setCache } = require('../../supbaseCache'); // cache helper

// 🔄 Retry helper for 429 Too Many Requests
async function fetchWithRetry(url, headers, retries = 3, delay = 500) {
  try {
    return await axios.get(url, { headers });
  } catch (err) {
    if (err.response?.status === 429 && retries > 0) {
      console.warn(`429 received (Services.js), retrying in ${delay}ms...`);
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

  // ✅ Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
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

    const groupId = event.queryStringParameters?.id;
    const locationId = '7LYI93XFo8j4nZfswlaz'; // hardcoded, can make dynamic later

    if (!groupId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing groupId in query string (?id=...)' })
      };
    }

    // 🔹 Step 1: calendars list
    const response = await axios.get(
      `https://services.leadconnectorhq.com/calendars/?groupId=${groupId}&locationId=${locationId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: '2021-04-15'
        }
      }
    );

    const calendars = response.data?.calendars || [];

    // 🔹 Step 2: prefetch slots in background (sequential with throttling)
    (async () => {
      const today = new Date();
      const startDate = today.setHours(0, 0, 0, 0);
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + 10);

      for (const cal of calendars) {
        const calId = cal.id;
        try {
          const slotsUrl = `https://services.leadconnectorhq.com/calendars/${calId}/free-slots?startDate=${startDate}&endDate=${endDate.getTime()}`;

          // throttle each request (500ms apart)
          await new Promise(r => setTimeout(r, 500));

          const slotRes = await fetchWithRetry(slotsUrl, {
            Authorization: `Bearer ${accessToken}`,
            Version: '2021-04-15'
          });

          // Format slots (Mountain Time)
          const formattedSlots = {};
          Object.entries(slotRes.data).forEach(([date, value]) => {
            if (date === 'traceId') return;
            if (!value.slots?.length) return;
            formattedSlots[date] = value.slots.map(slot =>
              new Date(slot).toLocaleString('en-US', {
                timeZone: 'America/Denver',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              })
            );
          });

          const cacheKey = `prefetch:${calId}:${startDate}:${endDate.getTime()}`;
          await setCache(cacheKey, { calendarId: calId, formattedSlots }, 10);

          console.log(`✅ Cached next 10 days slots for calendar ${calId}`);
        } catch (slotErr) {
          console.error(`❌ Prefetch failed for ${cal.id}:`, slotErr.message);
        }
      }
    })();

    // 🔹 Step 3: return calendars immediately
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response.data)
    };

  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    console.error("❌ Error fetching calendars:", message);

    return {
      statusCode: status,
      headers: corsHeaders,
      body: JSON.stringify({ error: message })
    };
  }
};
