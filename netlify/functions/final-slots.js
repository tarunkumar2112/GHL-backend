const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { getValidAccessToken } = require("../../supbase");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Retry helper
async function fetchWithRetry(url, headers, retries = 3, delay = 500) {
  try {
    return await axios.get(url, { headers });
  } catch (err) {
    if (err.response?.status === 429 && retries > 0) {
      await new Promise((r) => setTimeout(r, delay));
      return fetchWithRetry(url, headers, retries - 1, delay * 2);
    }
    throw err;
  }
}

// Convert Date string -> minutes since midnight (Denver local)
function toMinutes(dateStr) {
  const d = new Date(dateStr);
  return d.getHours() * 60 + d.getMinutes();
}

// Normalize weekend_days field
function getWeekendDays(weekendField) {
  if (!weekendField) return [];
  if (typeof weekendField === "string") {
    try {
      return JSON.parse(weekendField).map((n) => Number(n));
    } catch {
      return weekendField
        .split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => !isNaN(n));
    }
  }
  if (Array.isArray(weekendField)) return weekendField.map((n) => Number(n));
  return [];
}

// Format slot string to "hh:mm AM/PM" in Mountain Time
function formatSlot(slot) {
  return new Date(slot).toLocaleString("en-US", {
    timeZone: "America/Denver",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

exports.handler = async function (event) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const accessToken = await getValidAccessToken();
    const { calendarId, userId, date } = event.queryStringParameters || {};

    if (!calendarId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "calendarId parameter is required" }),
      };
    }

    // Fetch slots from GHL
    const fetchSlots = async (start, end) => {
      let url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}`;
      if (userId) url += `&userId=${userId}`;
      const response = await fetchWithRetry(url, {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-04-15",
      });
      return response.data;
    };

    // Build 30-day range
    let startDate = date ? new Date(date) : new Date();
    const daysToCheck = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      return d;
    });
    const startOfRange = daysToCheck[0].toISOString();
    const endOfRange = daysToCheck[daysToCheck.length - 1].toISOString();

    const slotsData = await fetchSlots(startOfRange, endOfRange);

    // 🔹 Business hours
    const { data: businessHours } = await supabase
      .from("business_hours")
      .select("*")
      .eq("calendar_id", calendarId);

    // 🔹 Barber hours (if filtering by barber)
    let barberHours = null;
    if (userId) {
      const { data } = await supabase
        .from("barber_hours")
        .select("*")
        .eq("user_id", userId)
        .eq("calendar_id", calendarId)
        .single();
      barberHours = data;
    }

    const weekendDays = barberHours
      ? getWeekendDays(barberHours.weekend_days)
      : [];

    // 🔹 Filtering
    const filtered = {};
    for (let d of daysToCheck) {
      const key = d.toISOString().split("T")[0];
      const weekday = d.getDay(); // 0=Sun..6=Sat

      let slots = slotsData[key]?.slots || [];
      if (!slots.length) continue;

      // Business hours for this weekday
      const bh = businessHours.find((b) => Number(b.weekday) === weekday);
      if (!bh) continue;

      const businessStart = parseInt(bh.start_time, 10);
      const businessEnd = parseInt(bh.end_time, 10);

      // Skip if barber has weekend
      if (weekendDays.includes(weekday)) {
        console.log(`Skipping ${key} (weekday ${weekday}) because it's barber weekend`);
        continue;
      }

      // Barber hours
      let barberStart = businessStart;
      let barberEnd = businessEnd;
      if (barberHours) {
        if (barberHours.start_time && barberHours.end_time) {
          barberStart = parseInt(barberHours.start_time, 10);
          barberEnd = parseInt(barberHours.end_time, 10);
        }
      }

      const minStart = Math.max(businessStart, barberStart);
      const maxEnd = Math.min(businessEnd, barberEnd);

      console.log("Filter info:", {
        date: key,
        weekday,
        businessStart,
        businessEnd,
        barberStart,
        barberEnd,
        minStart,
        maxEnd,
        firstSlot: slots[0],
        firstSlotMins: toMinutes(slots[0]),
      });

      const validSlots = slots
        .filter((s) => {
          const mins = toMinutes(s);
          return mins >= minStart && mins <= maxEnd;
        })
        .map(formatSlot);

      if (validSlots.length) filtered[key] = validSlots;
    }

    const responseData = {
      calendarId,
      activeDay: "allDays",
      userId: userId || null,
      startDate: startDate.toISOString().split("T")[0],
      slots: filtered,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseData),
    };
  } catch (err) {
    console.error("❌ Error in final-slots:", err);
    return {
      statusCode: err.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to fetch final slots",
        details: err.response?.data || err.message,
      }),
    };
  }
};
