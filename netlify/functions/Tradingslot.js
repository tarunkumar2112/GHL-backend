const axios = require("axios");
const { getValidAccessToken } = require("../../supbase");
const { createClient } = require("@supabase/supabase-js");

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🔄 Retry helper for 429
async function fetchWithRetry(url, headers, retries = 3, delay = 500) {
  try {
    return await axios.get(url, { headers });
  } catch (err) {
    if (err.response?.status === 429 && retries > 0) {
      console.warn(`429 received, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      return fetchWithRetry(url, headers, retries - 1, delay * 2);
    }
    throw err;
  }
}

// ✅ Convert a Date → HHMM in specific timezone (America/Denver)
function timeToNumberInTZ(date, tz = "America/Denver") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour").value);
  const minute = Number(parts.find((p) => p.type === "minute").value);
  return hour * 100 + minute;
}

// ✅ Load business hours from Supabase/Airtable sync
async function getBusinessHours() {
  const { data, error } = await supabase.from("business_hours").select("*");

  if (error) {
    console.error("❌ Error loading business_hours:", error.message);
    throw error;
  }

  // Map day_of_week → { is_open, start, end }
  const hours = {};
  data.forEach((row) => {
    hours[row.day_of_week] = {
      is_open: row.is_open,
      start: row.open_time
        ? Number(row.open_time.replace(":", "").slice(0, 4))
        : null,
      end: row.close_time
        ? Number(row.close_time.replace(":", "").slice(0, 4))
        : null,
    };
  });

  return hours;
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
    if (!accessToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Access token missing" }),
      };
    }

    const { calendarId, userId, date } = event.queryStringParameters || {};
    if (!calendarId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "calendarId parameter is required" }),
      };
    }

    // Load business hours from Supabase
    const businessHours = await getBusinessHours();

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

    // ✅ Filter slots against business hours
    const filterSlots = (slotsData) => {
      const filtered = {};
      Object.entries(slotsData).forEach(([dateStr, value]) => {
        if (dateStr === "traceId" || !value.slots?.length) return;

        const d = new Date(dateStr);
        const dayOfWeek = d.getDay(); // 0=Sun, 6=Sat
        const rule = businessHours[dayOfWeek];

        if (!rule || !rule.is_open) return;

        const validSlots = value.slots
          .map((slot) => new Date(slot))
          .filter((dt) => {
            const num = timeToNumberInTZ(dt, "America/Denver");
            return num >= rule.start && num <= rule.end;
          })
          .map((dt) =>
            dt.toLocaleString("en-US", {
              timeZone: "America/Denver",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })
          );

        if (validSlots.length > 0) {
          filtered[dateStr] = validSlots;
        }
      });
      return filtered;
    };

    // Build date range
    const getDayRange = (day) => ({
      start: new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        0,
        0,
        0,
        0
      ).getTime(),
      end: new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        23,
        59,
        59,
        999
      ).getTime(),
    });

    let startDate = new Date();
    if (date) {
      const parts = date.split("-");
      if (parts.length === 3) {
        startDate = new Date(
          Number(parts[0]),
          Number(parts[1]) - 1,
          Number(parts[2])
        );
      }
    }

    const totalDays = 30;
    const daysToCheck = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      daysToCheck.push(d);
    }

    const { start: startOfRange } = getDayRange(daysToCheck[0]);
    const { end: endOfRange } = getDayRange(daysToCheck[daysToCheck.length - 1]);

    const slotsData = await fetchSlots(startOfRange, endOfRange);
    const filtered = filterSlots(slotsData);

    const responseData = {
      calendarId,
      activeDay: "allDays",
      startDate: startDate.toISOString().split("T")[0],
      slots: filtered,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseData),
    };
  } catch (err) {
    console.error("❌ Error in BusinessSlots:", err.response?.data || err.message);
    return {
      statusCode: err.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to fetch business slots",
        details: err.response?.data || err.message,
      }),
    };
  }
};
