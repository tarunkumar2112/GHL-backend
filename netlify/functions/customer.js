const axios = require('axios');
const { getValidAccessToken } = require('../../supbase'); // auto-refresh helper
const { saveContactToDB } = require('../../supabaseContacts'); // 👈 new helper

exports.handler = async function (event) {
  try {
    console.log('👉 Incoming request params:', event.queryStringParameters);

    const accessToken = await getValidAccessToken();
    console.log('✅ Got access token?', !!accessToken);

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
      console.warn('⚠️ Missing required params:', params);
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
    console.log('📤 Sending to LeadConnector:', body);

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

    console.log('✅ LeadConnector response:', response.data);

    // ✅ Step 2: Store contact in Supabase (Restyle_customers table)
    try {
      console.log('📥 Saving to Supabase:', response.data.contact);
      const dbResult = await saveContactToDB(response.data.contact);
      console.log('✅ Supabase insert result:', dbResult);
    } catch (dbErr) {
      console.error('❌ Supabase save failed:', dbErr);
      throw new Error(`Supabase insert error: ${dbErr.message}`);
    }

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
