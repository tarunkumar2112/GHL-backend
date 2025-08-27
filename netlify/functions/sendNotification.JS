const axios = require("axios");
const { getValidAccessToken } = require("../../supbase");

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

    const calendarId = event.queryStringParameters?.id;
    if (!calendarId) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing calendarId" }),
      };
    }

    const payload = [
      {
        receiverType: "contact",
        channel: "email",
        notificationType: "booked",
        isActive: true,
        subject: "Your booking is confirmed 🎉",
        body: `
          Hi {{contact.firstName}},<br><br>
          Thank you for booking with us!<br><br>
          View your booking here:<br>
          <a href="https://restyle-93b772.webflow.io/bookings?id={{contact.id}}">
            View Booking
          </a><br><br>
          See you soon!<br>
        `,
        fromAddress: "noreply@yourdomain.com",
        fromName: "Restyle Team",
      },
    ];

    const response = await axios.post(
      `https://services.leadconnectorhq.com/calendars/${calendarId}/notifications`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          Version: "2021-04-15",
        },
      }
    );

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Notification configured ✅", data: response.data }),
    };
  } catch (err) {
    console.error("❌ Notification setup failed:", err.response?.data || err.message);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to configure notification" }),
    };
  }
};
