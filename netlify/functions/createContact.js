const axios = require('axios');
const { getStoredTokens } = require('../../token'); // Update path if needed

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

    const data = JSON.parse(event.body || '{}');
    const { firstName, lastName, email, phone, notes } = data;

    // ✅ Required fields check
    if (!firstName || !lastName || !email || !phone) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error: 'Missing required fields: firstName, lastName, email, or phone'
        })
      };
    }

    const locationId = 've9EPM428h8vShlRW1KT'; // 🔒 Hardcoded location ID

    const body = {
      firstName,
      lastName,
      email,
      phone,
      locationId,
      source: 'public api',
      country: 'US',
      tags: notes ? [notes] : []
    };

    const config = {
      method: 'post',
      url: 'https://services.leadconnectorhq.com/contacts/',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json'
      },
      data: body
    };

    const response = await axios(config);

    return {
      statusCode: 201,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ success: true, contact: response.data })
    };

  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;

    // 🔁 Duplicate contact handling
    if (status === 422 && message?.message?.includes('already exists')) {
      return {
        statusCode: 409,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Contact already exists', details: message })
      };
    }

    console.error('❌ Error creating contact:', message);
    return {
      statusCode: status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Failed to create contact', details: message })
    };
  }
};
