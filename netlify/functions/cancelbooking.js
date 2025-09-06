// netlify/functions/cancelbooking.js
const axios = require("axios");
const { getValidAccessToken } = require("../../supbase"); // Agar isse bhi hataana hai to bata dena

exports.handler = async function (event) {
  // 🔹 Handle preflight OPTIONS request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: "Preflight OK",
    };
  }

  try {
    const accessToken = await getValidAccessToken();

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

    // Get booking ID from request body
    let bookingId;
    try {
      const body = JSON.parse(event.body || "{}");
      bookingId = body.bookingId;
    } catch (parseError) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Invalid JSON in request body" }),
      };
    }

    if (!bookingId) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Missing required parameter: bookingId" }),
      };
    }

    // 🔴 Cancel booking in LeadConnector (update status to cancelled instead of delete)
    let apiCancelResult = null;
    try {
      // First, get the appointment details to update it
      const getResponse = await axios.get(
        `https://services.leadconnectorhq.com/calendars/events/${bookingId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Version: "2021-04-15",
          },
        }
      );

      const appointment = getResponse.data;

      // Update the appointment status to cancelled
      const updateResponse = await axios.put(
        `https://services.leadconnectorhq.com/calendars/events/${bookingId}`,
        {
          appointmentStatus: "cancelled",
          toNotify: true, // Notify the customer
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Version: "2021-04-15",
            "Content-Type": "application/json",
          },
        }
      );

      apiCancelResult = updateResponse.data;
    } catch (apiError) {
      console.error("❌ API cancel error:", apiError.response?.data || apiError.message);
      return {
        statusCode: apiError.response?.status || 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error: "Failed to cancel booking in API",
          details: apiError.response?.data || apiError.message,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        message: "Booking cancelled successfully",
        apiCancelResult,
      }),
    };
  } catch (err) {
    console.error("❌ Unexpected error in cancelbooking:", err);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Unexpected server error",
        details: err.message,
      }),
    };
  }
};
