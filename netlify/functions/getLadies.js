const axios = require('axios');
const { getValidAccessToken } = require('../../token'); // 🔁 Auto-refresh enabled

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

    // ✅ Hardcoded location and group ID (Ladies)
    const locationId = '7LYI93XFo8j4nZfswlaz';
    const groupId = 'HOtwCH6rCz43svmU5X3M';

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
    console.error("❌ Error fetching ladies calendars:", err.response?.data || err.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Failed to fetch ladies calendars' })
    };
  }
};
