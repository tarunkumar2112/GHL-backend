const axios = require('axios');
const { getValidAccessToken } = require('../../supbase'); // auto-refresh helper
const { saveContactToDB } = require('../../supabaseContacts'); // 👈 new helper

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

    const params = event.queryStringParameters || {};
    const { firstName, lastName, email, phone, notes } = params;

    if (!firstName || !lastName || !email || !phone) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Missing required query params' })
      };
    }

    const locationId = '7LYI93XFo8j4nZfswlaz'; // 🔒 Hardcoded

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

    // ✅ Step 1: Create contact in LeadConnector
    const response = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      body,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json'
        }
      }
    );

    // ✅ Step 2: Store contact in Supabase (Restyle_customers table)
    await saveContactToDB(response.data.contact);

    // ✅ Step 3: Return success to client
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

    if (status === 422 && message?.message?.includes('already exists')) {
      return {
        statusCode: 409,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error: 'Contact already exists',
          details: message
        })
      };
    }

    console.error('❌ Error creating contact:', message);
    return {
      statusCode: status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Failed to create contact',
        details: message
      })
    };
  }
};
