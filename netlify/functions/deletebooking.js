// netlify/functions/deletebooking.js
const axios = require("axios")
const { getValidAccessToken } = require("../../supbase")
const { deleteBookingFromDB } = require("../../deleteSupabase")

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
    }
  }

  try {
    const accessToken = await getValidAccessToken()

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Access token missing" }),
      }
    }

    const params = event.queryStringParameters || {}
    const bookingId = params.bookingId

    if (!bookingId) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Missing required parameter: bookingId" }),
      }
    }

    // 🔴 Delete booking in LeadConnector
    let apiDeleteResult = null
    try {
      const response = await axios.delete(
        `https://services.leadconnectorhq.com/calendars/events/${bookingId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Version: "2021-04-15",
          },
        }
      )
      apiDeleteResult = response.data
    } catch (apiError) {
      return {
        statusCode: apiError.response?.status || 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error: "Failed to delete booking from API",
          details: apiError.response?.data || apiError.message,
        }),
      }
    }

    // 🗑️ Delete booking in Supabase
    let supabaseDeleteResult = null
    try {
      supabaseDeleteResult = await deleteBookingFromDB(bookingId)
    } catch (dbErr) {
      supabaseDeleteResult = { error: dbErr.message }
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        message: "Booking deleted successfully",
        apiDeleteResult,
        supabaseDeleteResult,
      }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Unexpected server error", details: err.message }),
    }
  }
}
