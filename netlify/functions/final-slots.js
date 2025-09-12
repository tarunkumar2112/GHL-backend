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

// Convert Date string -> minutes since midnight
function toMinutes(dateStr) {
  const d = new Date(dateStr);
  return d.getHours() * 60 + d.getMinutes();
}

// Normalize weekend_days field
function getWeekendDays(weekendField) {
  if (!weekendField) return [];
  if (typeof weekendField === "string") {
    try {
      return JSON.parse(weekendField);
    } catch {
      return [];
    }
  }
  if (Array.isArray(weekendField)) return weekendField;
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
    const startOfRange = daysToCheck[0].setHours(0, 0, 0, 0);
    const endOfRange = daysToCheck[daysToCheck.length - 1].setHours(
      23,
      59,
      59,
      999
    );

    const slotsData = await fetchSlots(startOfRange, endOfRange);

    // 🔹 Business hours
    const { data: businessHours } = await supabase
      .from("business_hours")
      .select("*");

    // 🔹 Barber hours (if filtering by barber)
    let barberHours = null;
    if (userId) {
      const { data } = await supabase
        .from("barber_hours")
        .select("*")
        .eq("ghl_id", userId)
        .single();
      barberHours = data;
    }

    // 🔹 Filtering
    const filtered = {};
    for (let d of daysToCheck) {
      const key = d.toISOString().split("T")[0];
      const weekday = d.getDay(); // 0=Sun..6=Sat

      let slots = slotsData[key]?.slots || [];
      if (!slots.length) continue;

      // Business hours for this weekday
      const bh = businessHours.find((b) => Number(b.day_of_week) === weekday);
      if (!bh || !bh.is_open) continue;

      const businessStart = parseInt(bh.open_time, 10);
      const businessEnd = parseInt(bh.close_time, 10);

      // Barber hours (override if present)
      let barberStart = businessStart;
      let barberEnd = businessEnd;
      if (barberHours) {
        const weekendDays = getWeekendDays(barberHours.weekend_days);
        if (weekendDays.includes(bh.Name)) {
          continue; // skip whole day
        }

        const dayMap = [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ];
        const dayName = dayMap[weekday];
        const startField = `${dayName}/Start Value`;
        const endField = `${dayName}/End Value`;
        if (barberHours[startField] && barberHours[endField]) {
          barberStart = parseInt(barberHours[startField], 10);
          barberEnd = parseInt(barberHours[endField], 10);
        }
      }

      const minStart = Math.max(businessStart, barberStart);
      const maxEnd = Math.min(businessEnd, barberEnd);

      const validSlots = slots
        .filter((s) => {
          const mins = toMinutes(s);
          return mins >= minStart && mins <= maxEnd;
        })
        .map(formatSlot); // 🔹 format to "hh:mm AM/PM"

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
