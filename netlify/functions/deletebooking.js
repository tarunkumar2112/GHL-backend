const axios = require("axios");
const { getValidAccessToken } = require("../../supbase"); // same as your reference

exports.handler = async function (event) {
  try {
    const accessToken = await getValidAccessToken();
    console.log("🔑 AccessToken:", accessToken);

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Access token missing" }),
      };
    }

    const params = event.queryStringParameters || {};
    const { bookingId } = params;

    if (!bookingId) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "❌ bookingId is required" }),
      };
    }

    const response = await axios.delete(
      `https://services.leadconnectorhq.com/calendars/events/${bookingId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: "2021-04-15",
          Accept: "application/json",
        },
      }
    );

    console.log("✅ Delete Response:", response.data);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        message: "Booking deleted successfully",
        data: response.data,
      }),
    };
  } catch (err) {
    console.error("❌ Delete booking error:", err.response?.data || err.message);

    return {
      statusCode: err.response?.status || 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: false,
        message: "Failed to delete booking",
        error: err.response?.data || err.message,
      }),
    };
  }
};
