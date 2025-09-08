const axios = require("axios");
const { getValidAccessToken } = require("../../supbase");
const { cancelBookingInDB } = require("../../cancelsupabase");

console.log("✂️ cancelBooking function - created 2025-09-08");

// Common headers for CORS
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async function (event) {
  // Handle preflight OPTIONS request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: "CORS preflight OK" }),
    };
  }

  try {
    const accessToken = await getValidAccessToken();

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Access token missing" }),
      };
    }

    const params = event.queryStringParameters || {};
    const { appointmentId } = params;

    if (!appointmentId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Missing required parameter: appointmentId" }),
      };
    }

    // 📝 Payload for cancel
    const payload = {
      appointmentStatus: "cancelled",
    };

    // ✂️ Cancel appointment via API
    const response = await axios.put(
      `https://services.leadconnectorhq.com/calendars/events/appointments/${appointmentId}`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: "2021-04-15",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    const cancelledBooking = response.data || null;
    console.log("✂️ Cancelled booking:", cancelledBooking);

    // 💾 Update booking in Supabase
    let dbUpdate = null;
    try {
      if (!cancelledBooking || !cancelledBooking.id) {
        throw new Error("Invalid booking data received from API");
      }
      dbUpdate = await cancelBookingInDB(cancelledBooking);
    } catch (dbError) {
      console.error("❌ DB update failed:", dbError.message);
      console.error("❌ Booking data that failed:", JSON.stringify(cancelledBooking, null, 2));
      dbUpdate = { error: dbError.message };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "✅ Appointment cancelled successfully",
        response: cancelledBooking,
        dbUpdate,
      }),
    };
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    console.error("❌ Cancel appointment failed:", message);

    return {
      statusCode: status,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Cancel failed",
        details: message,
      }),
    };
  }
};
