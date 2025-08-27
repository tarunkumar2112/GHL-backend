const axios = require("axios");
const { getValidAccessToken } = require("../../supbase");
const { saveBookingToDB } = require("../../supabaseAppointments");

// ✅ import sendNotification
const { handler: sendNotification } = require("sendNotification");

console.log("📅 bookAppointment function - updated with notification");

exports.handler = async function (event) {
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

    const params = event.queryStringParameters || {};
    const { contactId, calendarId, assignedUserId, startTime, endTime } = params;

    if (!contactId || !calendarId || !startTime || !endTime) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error: "Missing required parameters: contactId, calendarId, startTime, endTime",
        }),
      };
    }

    const payload = {
      title: "Booking from Restyle website",
      meetingLocationType: "custom",
      meetingLocationId: "custom_0",
      overrideLocationConfig: true,
      appointmentStatus: "confirmed",
      address: "Zoom",
      ignoreDateRange: true,
      toNotify: true,
      ignoreFreeSlotValidation: true,
      calendarId,
      locationId: "7LYI93XFo8j4nZfswlaz", // ⚡ your fixed location
      contactId,
      startTime,
      endTime,
    };

    if (assignedUserId) {
      payload.assignedUserId = assignedUserId;
    }

    // ✅ Create booking
    const response = await axios.post(
      "https://services.leadconnectorhq.com/calendars/events/appointments",
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: "2021-04-15",
          "Content-Type": "application/json",
        },
      }
    );

    const newBooking = response.data || null;
    console.log("📅 Extracted booking:", newBooking);

    let dbInsert = null;
    let notifResult = null;

    try {
      if (!newBooking || !newBooking.id) {
        throw new Error("Invalid booking data received from API");
      }

      // ✅ Save booking to Supabase
      dbInsert = await saveBookingToDB(newBooking);

      // ✅ Trigger notification setup
      try {
        const notifEvent = { queryStringParameters: { id: calendarId } };
        notifResult = await sendNotification(notifEvent);
        console.log("📧 Notification triggered:", notifResult.body);
      } catch (notifErr) {
        console.error("❌ Failed to trigger notification:", notifErr.message);
        notifResult = { error: notifErr.message };
      }
    } catch (dbError) {
      console.error("❌ DB save failed:", dbError.message);
      console.error("❌ Booking data that failed:", JSON.stringify(newBooking, null, 2));
      dbInsert = { error: dbError.message };
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "✅ Booking success",
        response: response.data,
        dbInsert,
        notifResult,
      }),
    };
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    console.error("❌ Booking failed:", message);

    return {
      statusCode: status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Booking failed",
        details: message,
      }),
    };
  }
};
