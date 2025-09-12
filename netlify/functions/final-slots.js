const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { getValidAccessToken } = require("../../supbase");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    const { calendarId, userId, date } = event.queryStringParameters || {};

    if (!calendarId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "calendarId is required" })
      };
    }

    // ✅ Determine the start date
    let startDate = new Date();
    if (date) {
      const parts = date.split("-");
      if (parts.length === 3) {
        startDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      }
    }

    const totalDays = 30;
    const daysToCheck = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      daysToCheck.push(d);
    }

    const { start: startOfRange } = {
      start: new Date(daysToCheck[0].getFullYear(), daysToCheck[0].getMonth(), daysToCheck[0].getDate(), 0, 0, 0)
    };
    const { end: endOfRange } = {
      end: new Date(daysToCheck[daysToCheck.length - 1].getFullYear(), daysToCheck[daysToCheck.length - 1].getMonth(), daysToCheck[daysToCheck.length - 1].getDate(), 23, 59, 59)
    };

    // ✅ Fetch all slots in the next 30 days
    const fetchSlots = async (start, end) => {
      const url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${start.getTime()}&endDate=${end.getTime()}`;
      const response = await fetchWithRetry(url, {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-04-15"
      });
      return response.data;
    };

    const slotsData = await fetchSlots(startOfRange, endOfRange);

    // ✅ Fetch all business hours at once
    const { data: businessHoursData, error: bhError } = await supabase
      .from("business_hours")
      .select("*")
      .eq("is_open", true);

    if (bhError) throw new Error("Failed to fetch business hours");

    // ✅ Map business hours by day_of_week for faster lookup
    const businessHoursMap = {};
    businessHoursData.forEach(item => {
      businessHoursMap[item.day_of_week] = item;
    });

    // ✅ Format and filter slots by business hours
    const filteredSlots = {};
    for (const day of daysToCheck) {
      const dateKey = day.toISOString().split("T")[0];
      const dayOfWeek = day.getDay();
      const bh = businessHoursMap[dayOfWeek];

      if (!bh) continue; // Closed on this day

      const openTime = bh.open_time;
      const closeTime = bh.close_time;

      const daySlots = slotsData[dateKey]?.slots || [];
      const validSlots = daySlots.filter(slot => {
        const timeString = new Date(slot).toLocaleString("en-US", {
          timeZone: "America/Denver",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true
        });
        const minutes = timeToMinutes(timeString);
        return isWithinRange(minutes, openTime, closeTime);
      });

      if (validSlots.length > 0) {
        filteredSlots[dateKey] = validSlots.map(slot => new Date(slot).toLocaleString("en-US", {
          timeZone: "America/Denver",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true
        }));
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        calendarId,
        activeDay: "allDays",
        startDate: startDate.toISOString().split("T")[0],
        slots: filteredSlots
      })
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
