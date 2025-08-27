const axios = require('axios');
const { getValidAccessToken } = require('../../supbase');

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

    // Expect contactId from query param: getContact.js?id=xxxx
    const contactId = event.queryStringParameters?.id;

    if (!contactId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Missing contactId in query parameters' })
      };
    }

    const response = await axios.get(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
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
    console.error("❌ Error fetching contact:", err.response?.data || err.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Failed to fetch contact' })
    };
  }
};
