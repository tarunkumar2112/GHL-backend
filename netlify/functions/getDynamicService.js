const axios = require('axios');
const { getValidAccessToken } = require('../../token'); // Ensure this is valid

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

    const groupId = event.queryStringParameters?.id;
    const locationId = '7LYI93XFo8j4nZfswlaz'; // Still hardcoded unless you want to parameterize this too

    if (!groupId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Missing groupId in query string (?id=...)' })
      };
    }

    const config = {
      method: 'get',
      url: `https://services.leadconnectorhq.com/calendars/?groupId=${groupId}&locationId=${locationId}`,
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
    console.error("❌ Error fetching calendars:", err.response?.data || err.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Failed to fetch calendars' })
    };
  }
};
