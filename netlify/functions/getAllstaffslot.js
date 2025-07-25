const axios = require('axios');
const { getStoredTokens } = require('../../token');

exports.handler = async function (event) {
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

    const {
      calendarId,
      startDate,
      endDate,
      userId
    } = event.queryStringParameters;

    // ✅ Required parameters check
    if (!calendarId || !startDate || !endDate) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error: 'Missing required query parameters: calendarId, startDate, endDate.'
        })
      };
    }

    // Build the URL with optional userId
    const baseUrl = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots`;
    const params = new URLSearchParams({
      startDate,
      endDate
    });

    if (userId) {
      params.append('userId', userId);
    }

    const fullUrl = `${baseUrl}?${params.toString()}`;

    const config = {
      method: 'get',
      url: fullUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-04-15'
      }
    };

    const response = await axios(config);
    const slotsData = response.data;

    // 🕒 Format to Mountain Time
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

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ calendarId, formattedSlots })
    };

  } catch (err) {
    console.error('❌ Error fetching slots:', err.response?.data || err.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Failed to fetch staff slots' })
    };
  }
};
