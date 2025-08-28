// netlify/functions/deletebooking.js
const axios = require("axios")
const { getValidAccessToken } = require("../../supbase")
const { deleteBookingFromDB } = require("../../deleteSupabase")

exports.handler = async function (event) {
  try {
    const accessToken = await getValidAccessToken()

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Access token missing" }),
      }
    }

    const params = event.queryStringParameters || {}
    const bookingId = params.bookingId

    if (!bookingId) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required parameter: bookingId" }),
      }
    }

    // 🔴 Delete booking from LeadConnector
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
      console.log("✅ LeadConnector booking deleted:", apiDeleteResult)
    } catch (apiError) {
      console.error("❌ Failed to delete booking in LeadConnector:", apiError.response?.data || apiError.message)
      return {
        statusCode: apiError.response?.status || 500,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Failed to delete booking from API", details: apiError.response?.data || apiError.message }),
      }
    }

    // 🗑️ Delete booking from Supabase
    let supabaseDeleteResult = null
    try {
      supabaseDeleteResult = await deleteBookingFromDB(bookingId)
    } catch (dbErr) {
      console.error("❌ Failed to delete booking in Supabase:", dbErr.message)
      supabaseDeleteResult = { error: dbErr.message }
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        message: "Booking deleted successfully",
        apiDeleteResult,
        supabaseDeleteResult,
      }),
    }
  } catch (err) {
    console.error("❌ deletebooking.js error:", err.message)
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unexpected server error", details: err.message }),
    }
  }
}
