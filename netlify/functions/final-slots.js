const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { getValidAccessToken } = require("../../supbase");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Retry helper for 429 Too Many Requests
async function fetchWithRetry(url, headers, retries = 3, delay = 500) {
  try {
    return await axios.get(url, { headers });
  } catch (err) {
    if (err.response?.status === 429 && retries > 0) {
      console.warn(`429 received, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, headers, retries - 1, delay * 2);
    }
    throw err;
  }
}

// Convert "hh:mm AM/PM" to minutes
function timeToMinutes(timeString) {
  const [time, modifier] = timeString.split(" ");
  let [hours, minutes] = time.split(":").map(Number);

  if (modifier === "PM" && hours !== 12) {
    hours += 12;
  }
  if (modifier === "AM" && hours === 12) {
    hours = 0;
  }

  return hours * 60 + minutes;
}

// Check if a slot is within time ranges
function isWithinRange(minutes, start, end) {
  return minutes >= start && minutes <= end;
}

exports.handler = async function (event) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Access token missing" })
      };
    }

    const { calendarId, date } = event.queryStringParameters || {};
    if (!calendarId || !date) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "calendarId and date are required" })
      };
    }

    const day = new Date(date);
    const dayOfWeek = day.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // ✅ Fetch business hours for the day
    const { data: businessHours, error: bhError } = await supabase
      .from("business_hours")
      .select("*")
      .eq("day_of_week", dayOfWeek)
      .eq("is_open", true);

    if (bhError) {
      throw new Error("Failed to fetch business hours");
    }
    if (!businessHours.length) {
      // No business hours for this day → return empty slots
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          calendarId,
          activeDay: date,
          startDate: date,
          slots: {}
        })
      };
    }

    // ✅ Build the time range from business hours
    const openTime = businessHours[0].open_time;   // in minutes
    const closeTime = businessHours[0].close_time; // in minutes

    // ✅ Fetch all slots from GHL for that date
    const fetchSlots = async () => {
      const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
      const endOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);
      const url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${startOfDay.getTime()}&endDate=${endOfDay.getTime()}`;
      const response = await fetchWithRetry(url, {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-04-15"
      });
      return response.data;
    };

    const slotsData = await fetchSlots();

    // ✅ Format slots into readable times
    const formatSlots = (slotsObj) => {
      const formatted = {};
      Object.entries(slotsObj).forEach(([slotDate, value]) => {
        if (slotDate === "traceId") return;
        if (!value.slots?.length) return;

        // Filter slots by business hours
        const filteredSlots = value.slots.filter(slot => {
          const timeString = new Date(slot).toLocaleString("en-US", {
            timeZone: "America/Denver",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
          });
          const minutes = timeToMinutes(timeString);
          return isWithinRange(minutes, openTime, closeTime);
        });

        if (filteredSlots.length > 0) {
          formatted[slotDate] = filteredSlots.map(slot => new Date(slot).toLocaleString("en-US", {
            timeZone: "America/Denver",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
          }));
        }
      });
      return formatted;
    };

    const allFormatted = formatSlots(slotsData);

    const responseData = {
      calendarId,
      activeDay: date,
      startDate: date,
      slots: allFormatted
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseData)
    };

  } catch (err) {
    console.error("❌ Error in WorkingSlots:", err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to fetch working slots",
        details: err.message
      })
    };
  }
};
