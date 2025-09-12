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

// ✅ Load business hours
async function getBusinessHours() {
  const { data, error } = await supabase.from("business_hours").select("*");
  if (error) {
    console.error("❌ Error loading business_hours:", error.message);
    throw error;
  }

  const hours = {};
  data.forEach((row) => {
    hours[row.day_of_week] = {
      is_open: row.is_open,
      start: row.open_time, // minutes
      end: row.close_time,  // minutes
    };
  });

  return hours;
}

// ✅ Load barber hours
async function getBarberHours() {
  const { data, error } = await supabase.from("barber_hours").select("*");
  if (error) {
    console.error("❌ Error loading barber_hours:", error.message);
    throw error;
  }

  const barberHours = {};
  data.forEach((row) => {
    barberHours[row.ghl_id.trim()] = {
      Monday: { start: Number(row["Monday/Start Value"]), end: Number(row["Monday/End Value"]) },
      Tuesday: { start: Number(row["Tuesday/Start Value"]), end: Number(row["Tuesday/End Value"]) },
      Wednesday: { start: Number(row["Wednesday/Start Value"]), end: Number(row["Wednesday/End Value"]) },
      Thursday: { start: Number(row["Thursday/Start Value"]), end: Number(row["Thursday/End Value"]) },
      Friday: { start: Number(row["Friday/Start Value"]), end: Number(row["Friday/End Value"]) },
      Saturday: { start: Number(row["Saturday/Start Value"]), end: Number(row["Saturday/End Value"]) },
      Sunday: { start: Number(row["Sunday/Start Value"]), end: Number(row["Sunday/End Value"]) },
    };
  });

  return barberHours;
}

// ✅ Load time off
async function getTimeOff() {
  const { data, error } = await supabase.from("time_off").select("*");
  if (error) {
    console.error("❌ Error loading time_off:", error.message);
    throw error;
  }
  return data;
}

// ✅ Load time blocks
async function getTimeBlock() {
  const { data, error } = await supabase.from("time_block").select("*");
  if (error) {
    console.error("❌ Error loading time_block:", error.message);
    throw error;
  }
  return data;
}

// ✅ Check if a slot is within given start and end times in minutes
function isWithinTimeRange(slotMinutes, start, end) {
  return slotMinutes >= start && slotMinutes <= end;
}

// ✅ Check if a slot falls into time off entries
function isInTimeOff(slotDate, slotMinutes, timeOffList, barberId) {
  return timeOffList.some((entry) => {
    const startDate = new Date(entry["Event/Start"]);
    const endDate = new Date(entry["Event/End"]);
    const eventBarberId = entry.ghl_id.trim();

    if (eventBarberId !== "" && eventBarberId !== barberId) {
      return false;
    }

    return slotDate >= startDate && slotDate < endDate;
  });
}

// ✅ Check if a slot falls into time blocks (recurring or not)
function isInTimeBlock(slotDate, slotMinutes, timeBlocks, barberId) {
  return timeBlocks.some((block) => {
    const blockBarberId = block.ghl_id.trim();
    if (blockBarberId !== "" && blockBarberId !== barberId) {
      return false;
    }

    if (block["Block/Recurring"] === "true") {
      const days = block["Block/Recurring Day"].split(",");
      const daysOfWeek = days.map(d => d.trim().toLowerCase());
      const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const dayName = weekdays[slotDate.getDay()];
      if (!daysOfWeek.includes(dayName)) {
        return false;
      }
    } else {
      const blockDate = new Date(block["Block/Date"]);
      if (
        blockDate.getFullYear() !== slotDate.getFullYear() ||
        blockDate.getMonth() !== slotDate.getMonth() ||
        blockDate.getDate() !== slotDate.getDate()
      ) {
        return false;
      }
    }

    return isWithinTimeRange(slotMinutes, Number(block["Block/Start"]), Number(block["Block/End"]));
  });
}

// ✅ Filter slots against all rules
function filterSlots(slotsData, businessHours, barberHours, timeOffList, timeBlocks, barberId) {
  const filtered = {};
  Object.entries(slotsData).forEach(([dateStr, value]) => {
    if (dateStr === "traceId" || !value.slots?.length) return;

    const d = new Date(dateStr);
    const dayOfWeek = d.getDay();
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = weekdays[dayOfWeek];

    const bh = businessHours[dayOfWeek];
    if (!bh || !bh.is_open) return;

    const validSlots = value.slots
      .map((slot) => new Date(slot))
      .filter((dt) => {
        const slotMinutesNum = timeToNumberInTZ(dt, "America/Denver");
        const slotMinutes = Math.floor(slotMinutesNum / 100) * 60 + (slotMinutesNum % 100);

        // Business hours check
        if (!isWithinTimeRange(slotMinutes, bh.start, bh.end)) return false;

        if (barberId) {
          const barHours = barberHours[barberId]?.[dayName];
          if (!barHours) return false;

          if (!isWithinTimeRange(slotMinutes, barHours.start, barHours.end)) return false;
          if (isInTimeOff(dt, slotMinutes, timeOffList, barberId)) return false;
          if (isInTimeBlock(dt, slotMinutes, timeBlocks, barberId)) return false;
        }

        return true;
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
}

// ✅ Main handler
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

    const { calendarId, barberId, date } = event.queryStringParameters || {};
    if (!calendarId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "calendarId parameter is required" }),
      };
    }

    // Load all required data
    const [businessHours, barberHours, timeOffList, timeBlocks] = await Promise.all([
      getBusinessHours(),
      getBarberHours(),
      getTimeOff(),
      getTimeBlock()
    ]);

    // Prepare date range
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

    const getDayRange = (day) => ({
      start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).getTime(),
      end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).getTime(),
    });

    const { start: startOfRange } = getDayRange(daysToCheck[0]);
    const { end: endOfRange } = getDayRange(daysToCheck[daysToCheck.length - 1]);

    const slotsData = await fetchWithRetry(
      `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${startOfRange}&endDate=${endOfRange}`,
      { Authorization: `Bearer ${accessToken}`, Version: "2021-04-15" }
    ).then(res => res.data);

    const filtered = filterSlots(slotsData, businessHours, barberHours, timeOffList, timeBlocks, barberId);

    const responseData = {
      calendarId,
      barberId: barberId || null,
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
