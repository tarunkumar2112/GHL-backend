const axios = require('axios');
const { getStoredTokens } = require('../../token'); // 🔄 Adjust if path changes

exports.handler = async function (event) {
  try {
    const tokens = await getStoredTokens();
    const accessToken = tokens?.access_token;

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({ error: 'Access token missing' })
      };
    }

    // ✅ Handle preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
        body: 'OK'
      };
    }

    // 🧾 Parse incoming data
    const body = JSON.parse(event.body);

    const contactPayload = {
      firstName: body.firstName || 'Test',
      lastName: body.lastName || 'User',
      email: body.email,
      phone: body.phone,
      locationId: '7LYI93XFo8j4nZfswlaz'
    };

    const response = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      contactPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: '2021-04-15',
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'Contact created successfully',
        contactId: response.data.id,
        data: response.data
      })
    };

  } catch (err) {
    console.error('❌ Contact creation failed:', err.response?.data || err.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: err.response?.data || err.message
      })
    };
  }
};
