require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN: ENV_REFRESH_TOKEN,
  TOKEN_ENDPOINT
} = process.env;

// Save new tokens to Supabase
async function saveTokensToDB(data) {
  const { access_token, refresh_token, expires_in, user_id, location_id } = data;
  try {
    await pool.query(
      `INSERT INTO tokens (access_token, refresh_token, expires_in, user_id, location_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [access_token, refresh_token, expires_in, user_id, location_id]
    );
    console.log('✅ Tokens saved to Supabase DB');
  } catch (err) {
    console.error('❌ DB Save Error:', err.message);
  }
}

// Get the latest token
async function getStoredTokens() {
  try {
    const res = await pool.query(
      'SELECT * FROM tokens ORDER BY created_at DESC LIMIT 1'
    );
    return res.rows[0];
  } catch (err) {
    console.error('❌ DB Read Error:', err.message);
    return null;
  }
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
    console.log("🔐 Access Token:", tokens.access_token);

  } catch (err) {
    console.error("❌ Token Refresh Error:", err.response?.data || err.message);
  }
}

// Return valid token: refresh if expired
async function getValidAccessToken() {
  const tokens = await getStoredTokens();
  if (!tokens) {
    console.log("⚠️ No tokens in DB, refreshing...");
    await refreshAccessToken();
    return (await getStoredTokens()).access_token;
  }

  const fetchedTime = new Date(tokens.created_at).getTime();
  const expiresInMs = tokens.expires_in * 1000;
  const now = Date.now();

  if (now - fetchedTime > expiresInMs - 60000) {
    console.log("🔁 Token expired or near expiry. Refreshing...");
    await refreshAccessToken();
    return (await getStoredTokens()).access_token;
  }

  return tokens.access_token;
}

// CLI support
if (require.main === module) {
  refreshAccessToken();
}

module.exports = {
  refreshAccessToken,
  getStoredTokens,
  getValidAccessToken
};
