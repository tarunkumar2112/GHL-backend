const axios = require('axios');
const { getStoredTokens } = require('../../token');

exports.handler = async function (event) {
  try {
    const tokens = await getStoredTokens();
    const accessToken = tokens?.access_token;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: ''
      };
    }

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Access token missing' })
      };
    }

    const { calendarId = 'woILyX2cMn3skq1MaTgL', userId } = event.queryStringParameters || {};

    const fetchSlots = async (start, end) => {
      let url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}`;
      if (userId) url += `&userId=${userId}`;
      const config = {
        method: 'get',
        url,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: '2021-04-15'
        }
      };
      const response = await axios(config);
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

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const getDayRange = (day) => ({
      start: new Date(day.setHours(0, 0, 0, 0)).getTime(),
      end: new Date(day.setHours(23, 59, 59, 999)).getTime()
    });

    const { start: todayStart, end: todayEnd } = getDayRange(new Date());
    const todayData = await fetchSlots(todayStart, todayEnd);
    const todayFormatted = formatSlots(todayData);

    if (Object.keys(todayFormatted).length > 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          calendarId,
          activeDay: 'today',
          slots: todayFormatted
        })
      };
    }

    const { start: tomorrowStart, end: tomorrowEnd } = getDayRange(new Date(tomorrow));
    const tomorrowData = await fetchSlots(tomorrowStart, tomorrowEnd);
    const tomorrowFormatted = formatSlots(tomorrowData);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        calendarId,
        activeDay: 'tomorrow',
        slots: tomorrowFormatted
      })
    };
  } catch (err) {
    console.error('❌ Error in getactiveslot:', err.response?.data || err.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: JSON.stringify({ error: 'Failed to fetch active slots' })
    };
  }
};
