const axios = require('axios');
const { getValidAccessToken } = require('../../supbase'); 
const { saveContactToDB } = require('../../supabaseContacts'); 

exports.handler = async function (event) {
  try {
    console.log('👉 Incoming request params:', event.queryStringParameters);

    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return {
        statusCode: 401,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Access token missing' })
      };
    }

    const params = event.queryStringParameters || {};
    const { firstName, lastName, email, phone, notes } = params;

    if (!firstName || !lastName || !email || !phone) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
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

    // ✅ Step 1: Create contact in GHL (LeadConnector)
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

    const lcContact = response.data.contact.contact; // 👈 use inner object
    console.log('✅ LeadConnector contact created:', lcContact.id);

    // ✅ Step 2: Insert into Supabase
    console.log('📥 Saving to Supabase:', lcContact);
    const dbResult = await saveContactToDB(lcContact);
    console.log('✅ Supabase insert result:', dbResult);

    // ✅ Step 3: Return combined result
    return {
      statusCode: 201,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        ghlContact: lcContact,
        dbInsert: dbResult
      })
    };

  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    console.error('❌ Error creating contact:', message);

    return {
      statusCode: status,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to create contact', details: message })
    };
  }
};
