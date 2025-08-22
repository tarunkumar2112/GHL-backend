const axios = require('axios');
const { getValidAccessToken } = require('../../supbase'); // use auto-refresh

exports.handler = async function () {
  try {
    const accessToken = await getValidAccessToken();

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

    const calendarId = 'woILyX2cMn3skq1MaTgL';

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + 2);

    const startTimestamp = startDate.setHours(0, 0, 0, 0);
    const endTimestamp = endDate.setHours(23, 59, 59, 999);

    const url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${startTimestamp}&endDate=${endTimestamp}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-04-15'
      }
    });

    const slotsData = response.data;

    // 🎯 Format slots to MST
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
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    console.error('❌ Error fetching slots:', message);

    return {
      statusCode: status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: message })
    };
  }
};
