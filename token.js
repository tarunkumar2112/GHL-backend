require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN: ENV_REFRESH_TOKEN,
  TOKEN_ENDPOINT
} = process.env;

const tokenFile = path.join(__dirname, 'tokens.json');

// Read saved token (if exists)
function getStoredTokens() {
  if (fs.existsSync(tokenFile)) {
    return JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
  }
  return null;
}

// Save new tokens
function saveTokens(data) {
  const withTime = { ...data, fetched_at: new Date().toISOString() };
  fs.writeFileSync(tokenFile, JSON.stringify(withTime, null, 2));
  console.log("✅ Tokens saved/updated.");
}

// Refresh token function
async function refreshAccessToken() {
  try {
    const stored = getStoredTokens();
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

    saveTokens(tokens);
    console.log("🔐 Access Token:", tokens.access_token);

  } catch (err) {
    console.error("❌ Error refreshing access token:", err.response?.data || err.message);
  }
}

refreshAccessToken();
