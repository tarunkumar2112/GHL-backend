const axios = require('axios');
const { getValidAccessToken } = require('../../supbase');

exports.handler = async function () {
  try {
    const accessToken = await getValidAccessToken();
console.log(accessToken);
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

    const locationId = '7LYI93XFo8j4nZfswlaz'; 

    const response = await axios.get(
      `https://services.leadconnectorhq.com/calendars/groups?locationId=${locationId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: '2021-04-15'
        }
      }
    );

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(response.data)
    };

  } catch (err) {
    console.error("❌ Error fetching groups:", err.response?.data || err.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Failed to fetch groups' })
    };
  }
};
