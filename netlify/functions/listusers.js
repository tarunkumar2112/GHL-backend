const axios = require('axios');
const { getValidAccessToken } = require('../../supbase');

exports.handler = async function (event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    // Get valid access token from Supabase
    const accessToken = await getValidAccessToken();
    
    if (!accessToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Access token missing' })
      };
    }

    // Make request to GHL users endpoint
    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: 'https://services.leadconnectorhq.com/users/?locationId=7LYI93XFo8j4nZfswlaz',
      headers: { 
        'Accept': 'application/json', 
        'Authorization': `Bearer ${accessToken}`,
        'Version': '2021-04-15'
      }
    };

    const response = await axios.request(config);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: response.data,
        count: Array.isArray(response.data) ? response.data.length : 1
      })
    };

  } catch (error) {
    console.error('❌ Error fetching users:', error.response?.data || error.message);
    
    return {
      statusCode: error.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to fetch users',
        details: error.response?.data || error.message
      })
    };
  }
};
