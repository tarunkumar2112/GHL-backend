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

    // 📝 Start with user-provided fields
    const payload = {
      ...(title && { title }),
      ...(assignedUserId && { assignedUserId }),
      ...(startTime && { startTime }),
      ...(endTime && { endTime }),
      ...(calendarId && { calendarId }),
      ...(status && { appointmentStatus: status }),
    };

    // 🔎 Fetch existing appointment to fill in required fields if missing
    try {
      const currentRes = await axios.get(
        `https://services.leadconnectorhq.com/calendars/events/appointments/${appointmentId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Version: "2021-04-15",
            Accept: "application/json",
          },
        }
      );

      const current = currentRes.data || {};
      if (!payload.calendarId && current.calendarId) payload.calendarId = current.calendarId;
      if (!payload.assignedUserId && current.assignedUserId) payload.assignedUserId = current.assignedUserId;
      if (!payload.title && current.title) payload.title = current.title;
      if (!payload.address && current.address) payload.address = current.address;
      if (!payload.locationId && current.locationId) payload.locationId = current.locationId;
      if (!payload.meetingLocationType && current.meetingLocationType) payload.meetingLocationType = current.meetingLocationType;
      if (!payload.meetingLocationId && current.meetingLocationId) payload.meetingLocationId = current.meetingLocationId;
    } catch (prefetchErr) {
      console.warn("⚠️ Could not prefetch appointment details:", prefetchErr.response?.data || prefetchErr.message);
    }

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
