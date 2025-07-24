const axios = require('axios');
const { getValidAccessToken } = require('../../token');

exports.handler = async function (event) {
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

    const {
      serviceId,
      startDate,
      endDate,
      userId
    } = event.queryStringParameters;

    // ✅ Validate required parameters
    if (!serviceId || !startDate || !endDate || !userId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error: 'Missing required parameters: serviceId, startDate, endDate, and userId are all required.'
        })
      };
    }

    const timezone = 'America/Denver'; // Mountain Time (UTC -7)

    const url = `https://services.leadconnectorhq.com/calendars/${serviceId}/free-slots?startDate=${startDate}&endDate=${endDate}&userId=${userId}&timezone=${timezone}`;

    const config = {
      method: 'get',
      url,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-04-15'
      }
    };

    const response = await axios(config);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(response.data)
    };

  } catch (err) {
    console.error("❌ Error fetching free slots:", err.response?.data || err.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Failed to fetch free slots' })
    };
  }
};
