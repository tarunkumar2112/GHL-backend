const axios = require("axios");
const { getValidAccessToken } = require("../../supbase");
const { updateBookingInDB } = require("../../updatesupabasebooking");

console.log("✏️ updateAppointment function - created 2025-08-28");

exports.handler = async function (event) {
  try {
    const accessToken = await getValidAccessToken();

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Access token missing" }),
      };
    }

    const params = event.queryStringParameters || {};
    const { appointmentId, title, assignedUserId, startTime, endTime, calendarId, status } = params;

    if (!appointmentId) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required parameter: appointmentId" }),
      };
    }

    // 📝 Payload for update
    const payload = {
      ...(title && { title }),
      ...(assignedUserId && { assignedUserId }),
      ...(startTime && { startTime }),
      ...(endTime && { endTime }),
      ...(calendarId && { calendarId }),
      ...(status && { appointmentStatus: status }),
    };

    // If we are changing time windows, provide flags to reduce validation 400s
    if (startTime || endTime) {
      payload.ignoreFreeSlotValidation = true;
      payload.ignoreDateRange = true;
      payload.toNotify = true;
    }

    // ✏️ Update appointment via API
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

    const updatedBooking = response.data || null;
    console.log("✏️ Updated booking:", updatedBooking);

    // 💾 Update booking in Supabase
    let dbUpdate = null;
    try {
      if (!updatedBooking || !updatedBooking.id) {
        throw new Error("Invalid booking data received from API");
      }
      dbUpdate = await updateBookingInDB(updatedBooking);
    } catch (dbError) {
      console.error("❌ DB update failed:", dbError.message);
      console.error("❌ Booking data that failed:", JSON.stringify(updatedBooking, null, 2));
      dbUpdate = { error: dbError.message };
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "✅ Appointment updated successfully",
        response: updatedBooking,
        dbUpdate,
      }),
    };
  } catch (err) {
    const status = err.response?.status || 500;
    const details = err.response?.data || err.message;
    console.error("❌ Update appointment failed:", details);

    return {
      statusCode: status,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Update failed",
        details,
      }),
    };
  }
};
