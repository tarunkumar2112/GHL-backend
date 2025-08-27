const axios = require("axios");
const { getValidAccessToken } = require("../../supbase");
const { saveBookingToDB } = require("../../supabaseAppointments");

console.log("📅 bookAppointment function - updated with notification logging 2025-08-27");

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
          error:
            "Missing required parameters: contactId, calendarId, startTime, endTime",
        }),
      };
    }

    // --- create booking ---
    const bookingPayload = {
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
      locationId: "7LYI93XFo8j4nZfswlaz",
      contactId,
      startTime,
      endTime,
    };

    if (assignedUserId) {
      bookingPayload.assignedUserId = assignedUserId;
    }

    const bookingRes = await axios.post(
      "https://services.leadconnectorhq.com/calendars/events/appointments",
      bookingPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: "2021-04-15",
          "Content-Type": "application/json",
        },
      }
    );

    const newBooking = bookingRes.data || null;
    console.log("📅 Extracted booking:", newBooking);

    let dbInsert = null;
    try {
      if (!newBooking || !newBooking.id) {
        throw new Error("Invalid booking data received from API");
      }
      dbInsert = await saveBookingToDB(newBooking);
    } catch (dbError) {
      console.error("❌ DB save failed:", dbError.message);
      console.error(
        "❌ Booking data that failed:",
        JSON.stringify(newBooking, null, 2)
      );
      dbInsert = { error: dbError.message };
    }

    // --- send notification email ---
    let notifResponse = null;
    try {
      const notifPayload = [
        {
          receiverType: "contact",
          channel: "email",
          notificationType: "booked",
          isActive: true,
          subject: "Your booking is confirmed 🎉",
          body: `
            Hi,<br><br>
            Thank you for booking with us!<br><br>
            👉 <a href="https://restyle-93b772.webflow.io/bookings?id=${contactId}">
              View Your Booking
            </a><br><br>
            See you soon!
          `,
          fromAddress: "sutej@autograf.ca",
          fromName: "Restyle Team",
        },
      ];

      const notifRes = await axios.post(
        `https://services.leadconnectorhq.com/calendars/${calendarId}/notifications`,
        notifPayload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            Version: "2021-04-15",
          },
        }
      );

      console.log("📧 Notification API Response:", notifRes.status, notifRes.data);
      notifResponse = notifRes.data;
    } catch (notifErr) {
      console.error("❌ Failed to trigger notification:");
      console.error("Status:", notifErr.response?.status || "N/A");
      console.error("Data:", notifErr.response?.data || notifErr.message);

      notifResponse = {
        error: true,
        status: notifErr.response?.status || 500,
        details: notifErr.response?.data || notifErr.message,
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "✅ Booking success (notification attempted)",
        booking: newBooking,
        dbInsert,
        notification: notifResponse,
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
