const axios = require("axios");
const { getValidAccessToken } = require("../../supbase");

// retry helper
async function fetchWithRetry(url, headers, retries = 3, delay = 500) {
  try {
    return await axios.get(url, { headers });
  } catch (err) {
    if (err.response?.status === 429 && retries > 0) {
      console.warn(`429 received, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, headers, retries - 1, delay * 2);
    }
    throw err;
  }
}

exports.handler = async function (event) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  // preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Access token missing" })
      };
    }

    const { calendarId, userId, date } = event.queryStringParameters || {};
    if (!calendarId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "calendarId parameter is required" })
      };
    }

    // start date (default today)
    let startDate = new Date();
    if (date) {
      const parts = date.split("-");
      if (parts.length === 3) {
        startDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      }
    }

    // build 30-day range
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 30);

    const startMillis = startDate.getTime();
    const endMillis = endDate.getTime();

    let url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${startMillis}&endDate=${endMillis}`;
    if (userId) url += `&userId=${userId}`;

    const response = await fetchWithRetry(url, {
      Authorization: `Bearer ${accessToken}`,
      Version: "2021-04-15"
    });

    const slotsData = response.data;
    const output = {};

    Object.entries(slotsData).forEach(([date, value]) => {
      if (date === "traceId") return;
      output[date] = value.slots || [];
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(
        {
          calendarId,
          startDate: startDate.toISOString().split("T")[0],
          slots: output
        },
        null,
        2
      )
    };
  } catch (err) {
    console.error("❌ Error in test function:", err.response?.data || err.message);
    return {
      statusCode: err.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to fetch slots",
        details: err.response?.data || err.message
      })
    };
  }
};
