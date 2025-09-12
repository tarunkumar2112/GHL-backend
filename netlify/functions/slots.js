const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { getValidAccessToken } = require("../../supbase");

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🔄 Retry helper for 429 Too Many Requests
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

// ⏱ Convert "slot datetime" → minutes since midnight
const slotToMinutes = (slotDate) => {
  const d = new Date(slotDate);
  return d.getHours() * 60 + d.getMinutes();
};

// 🗓 Day name helper
const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

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

    // 🔹 Helper: fetch slots with retry
    const fetchSlots = async (start, end) => {
      let url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}`;
      if (userId) url += `&userId=${userId}`;

      const response = await fetchWithRetry(url, {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-04-15",
      });
      return response.data;
    };

    // 🔹 Get ranges for 30 days
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

    // ✅ Start date: ?date or today
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

    // ⏳ Fetch raw GHL slots
    const slotsData = await fetchSlots(startOfRange, endOfRange);

    // 📥 Fetch rules from Supabase
    const { data: businessHours } = await supabase
      .from("business_hours")
      .select("*");

    const { data: barberHours } = userId
      ? await supabase
          .from("barber_hours")
          .select("*")
          .eq("ghl_id", userId)
          .single()
      : { data: null };

    const { data: timeOff } = await supabase.from("time_off").select("*");
    const { data: timeBlocks } = await supabase.from("time_block").select("*");

    // 🔹 Apply filters
    const filtered = {};

    for (const [dayKey, val] of Object.entries(slotsData)) {
      if (dayKey === "traceId") continue;
      if (!val.slots?.length) continue;

      const dayDate = new Date(dayKey);
      const dayOfWeek = dayDate.getDay();
      const dayName = dayNames[dayOfWeek];

      let slots = val.slots;

      // 1️⃣ Filter by business hours
      const bh = businessHours.find((b) => Number(b.day_of_week) === dayOfWeek);
      if (!bh || bh.is_open === false) continue;
      slots = slots.filter((s) => {
        const m = slotToMinutes(s);
        return m >= bh.open_time && m <= bh.close_time;
      });

      // 2️⃣ Filter by barber hours (+ weekend check)
      if (barberHours) {
        if (
          barberHours.weekend_days &&
          barberHours.weekend_days.includes(dayName)
        ) {
          slots = [];
        } else {
          const startKey = `${dayName}/Start Value`;
          const endKey = `${dayName}/End Value`;
          const bhStart = barberHours[startKey];
          const bhEnd = barberHours[endKey];
          slots = slots.filter((s) => {
            const m = slotToMinutes(s);
            return m >= bhStart && m <= bhEnd;
          });
        }
      }

      // 3️⃣ Filter by time_off
      slots = slots.filter((s) => {
        const ts = new Date(s).getTime();
        return !timeOff.some((t) => {
          const start = new Date(t["Event/Start"]).getTime();
          const end = new Date(t["Event/End"]).getTime();
          return ts >= start && ts < end;
        });
      });

      // 4️⃣ Filter by time_block
      slots = slots.filter((s) => {
        const ts = new Date(s).getTime();
        const m = slotToMinutes(s);
        const thisDay = dayNames[new Date(s).getDay()];

        return !timeBlocks.some((tb) => {
          const blockStart = Number(tb["Block/Start"]);
          const blockEnd = Number(tb["Block/End"]);

          if (tb["Block/Recurring"] === "true") {
            if (tb["Block/Recurring Day"] === thisDay) {
              return m >= blockStart && m <= blockEnd;
            }
          } else {
            const blockDate = new Date(tb["Block/Date"]).toDateString();
            if (new Date(s).toDateString() === blockDate) {
              return m >= blockStart && m <= blockEnd;
            }
          }
          return false;
        });
      });

      // ✅ Format remaining slots as 12h AM/PM Mountain Time
      if (slots.length) {
        filtered[dayKey] = slots.map((s) =>
          new Date(s).toLocaleString("en-US", {
            timeZone: "America/Denver",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
        );
      }
    }

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
    console.error("❌ Error in Slots:", err.response?.data || err.message);
    return {
      statusCode: err.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to fetch slots",
        details: err.response?.data || err.message,
      }),
    };
  }
};
