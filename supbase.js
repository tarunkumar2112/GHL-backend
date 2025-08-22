require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Use service role key for server-side inserts/queries
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN: ENV_REFRESH_TOKEN,
  TOKEN_ENDPOINT
} = process.env;

// Save new tokens into Supabase
async function saveTokensToDB(data) {
  const { access_token, refresh_token, expires_in, user_id, location_id } = data;

  const { error } = await supabase
    .from('tokens')
    .insert([{
      access_token,
      refresh_token,
      expires_in,
      user_id,
      location_id,
      created_at: new Date().toISOString()
    }]);

  if (error) {
    console.error('❌ DB Save Error:', error.message);
  } else {
    console.log('✅ Tokens saved to Supabase DB');
  }
}

// Get the latest token
async function getStoredTokens() {
  const { data, error } = await supabase
    .from('tokens')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('❌ DB Read Error:', error.message);
    return null;
  }
  return data?.[0] || null;
}

// Refresh access token
async function refreshAccessToken() {
  try {
    const stored = await getStoredTokens();
    const currentRefreshToken = stored?.refresh_token || ENV_REFRESH_TOKEN;

    const payload = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: currentRefreshToken,
      user_type: 'Location',
    });

    const response = await axios.post(TOKEN_ENDPOINT, payload.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      }
    });

    const tokens = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_in: response.data.expires_in,
      user_id: response.data.userId,
      location_id: response.data.locationId
    };

    await saveTokensToDB(tokens);
    console.log("🔐 New Access Token:", tokens.access_token);

    return tokens.access_token;

  } catch (err) {
    console.error("❌ Token Refresh Error:", err.response?.data || err.message);
    return null;
  }
}

// Return valid token: refresh if expired
async function getValidAccessToken() {
  const tokens = await getStoredTokens();
  if (!tokens) {
    console.log("⚠️ No tokens in DB, refreshing...");
    return await refreshAccessToken();
  }

  const fetchedTime = new Date(tokens.created_at).getTime();
  const expiresInMs = tokens.expires_in * 1000;
  const now = Date.now();

  if (now - fetchedTime > expiresInMs - 60000) {
    console.log("🔁 Token expired or near expiry. Refreshing...");
    return await refreshAccessToken();
  }

  return tokens.access_token;
}

module.exports = {
  refreshAccessToken,
  getStoredTokens,
  getValidAccessToken
};
