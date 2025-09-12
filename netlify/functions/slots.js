// slots.js
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { getValidAccessToken } = require("../../supbase");

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Retry helper for 429
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

// Helper: get minutes in America/Denver for a given ISO slot string
function getMinutesInDenver(isoString) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(isoString));
  const hour = Number(parts.find((p) => p.type === "hour").value);
  const minute = Number(parts.find((p) => p.type === "minute").value);
  return hour * 60 + minute;
}

// Helper: get date-key (YYYY-MM-DD) in America/Denver for grouping
function getDenverDateKey(isoString) {
  return new Date(isoString).toLocaleDateString("sv-SE", {
    timeZone: "America/Denver",
  });
}

// Helper: get weekday name in America/Denver (e.g., "Friday")
function getDenverWeekdayName(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "long",
  }).format(new Date(isoString));
}

// Helper: format slot as "03:15 AM" in America/Denver
function formatSlotAs12h(isoString) {
  return new Date(isoString).toLocaleString("en-US", {
    timeZone: "America/Denver",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// Parse weekend_days robustly (array | postgres-array-text | json-string)
function parseWeekendDays(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(normalizeDayName);
  if (typeof val === "string") {
    // try JSON parse
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(normalizeDayName);
    } catch (e) {
      // fallback to strip braces/quotes and split by comma
      const cleaned = val.replace(/^[{\["']+|[}\]"']+$/g, "");
      const parts = cleaned
        .split(",")
        .map((s) => s.replace(/["'\s\]]/g, "").trim())
        .filter(Boolean);
      return parts.map(normalizeDayName);
    }
  }
  return [];
}

function normalizeDayName(d) {
  if (!d) return d;
  const s = String(d).trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// safe number parse
function toNumber(val, fallback = null) {
  if (val === null || val === undefined) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

// Helper: check if a slot time falls within a time range (in minutes)
function isSlotInTimeRange(slotMinutes, startMinutes, endMinutes) {
  if (startMinutes === null || endMinutes === null) return true;
  return slotMinutes >= startMinutes && slotMinutes < endMinutes;
}

// Helper: check if slot falls within time_off period
function isSlotDuringTimeOff(slotIso, timeOffEntry) {
  const slotTime = new Date(slotIso).getTime();
  const startTime = new Date(timeOffEntry["Event/Start"]).getTime();
  const endTime = new Date(timeOffEntry["Event/End"]).getTime();
  return slotTime >= startTime && slotTime < endTime;
}

// Helper: check if slot falls within time_block period
function isSlotDuringTimeBlock(slotIso, timeBlockEntry) {
  const slotMinutes = getMinutesInDenver(slotIso);
  const slotDateKey = getDenverDateKey(slotIso);
  const slotWeekday = getDenverWeekdayName(slotIso);
  
  const blockStart = toNumber(timeBlockEntry["Block/Start"], null);
  const blockEnd = toNumber(timeBlockEntry["Block/End"], null);
  const recurringRaw = timeBlockEntry["Block/Recurring"];
  const recurring = String(recurringRaw).toLowerCase() === "true";
  
  if (recurring) {
    // Recurring block - check if it matches the weekday
    const recurringDay = normalizeDayName(timeBlockEntry["Block/Recurring Day"]);
    if (!recurringDay || recurringDay !== slotWeekday) return false;
    return isSlotInTimeRange(slotMinutes, blockStart, blockEnd);
  } else {
    // Non-recurring block - check if it matches the specific date
    if (!timeBlockEntry["Block/Date"]) return false;
    const blockDateKey = new Date(timeBlockEntry["Block/Date"]).toLocaleDateString("sv-SE", { 
      timeZone: "America/Denver" 
    });
    if (blockDateKey !== slotDateKey) return false;
    return isSlotInTimeRange(slotMinutes, blockStart, blockEnd);
  }
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

    // fetch GHL slots (raw)
    const fetchSlots = async (start, end) => {
      let url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}`;
      if (userId) url += `&userId=${userId}`;
      const response = await fetchWithRetry(url, {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-04-15",
      });
      return response.data;
    };

    // date range (30 days)
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

    const startOfRange = new Date(daysToCheck[0].getFullYear(), daysToCheck[0].getMonth(), daysToCheck[0].getDate(), 0, 0, 0, 0).getTime();
    const endOfRange = new Date(daysToCheck[daysToCheck.length - 1].getFullYear(), daysToCheck[daysToCheck.length - 1].getMonth(), daysToCheck[daysToCheck.length - 1].getDate(), 23, 59, 59, 999).getTime();

    const rawSlotsData = await fetchSlots(startOfRange, endOfRange);

    // fetch rules
    const { data: businessHours } = await supabase.from("business_hours").select("*");
    // barber_hours for specific user
    let barberHours = null;
    if (userId) {
      const { data, error } = await supabase.from("barber_hours").select("*").eq("ghl_id", userId).maybeSingle();
      barberHours = data || null;
    }
    const { data: timeOffRows } = await supabase.from("time_off").select("*");
    const { data: timeBlockRows } = await supabase.from("time_block").select("*");

    // Re-group raw slots by their Denver date (YYYY-MM-DD) to avoid timezone mismatches
    const buckets = {};
    for (const [key, val] of Object.entries(rawSlotsData || {})) {
      if (key === "traceId") continue;
      const arr = val?.slots || [];
      for (const s of arr) {
        const localDay = getDenverDateKey(s); // YYYY-MM-DD in Denver
        if (!buckets[localDay]) buckets[localDay] = [];
        buckets[localDay].push(s);
      }
    }

    const resultSlots = {};


    // iterate day by day (Denver date keys)
    for (const [localDayKey, slotList] of Object.entries(buckets)) {
      if (!slotList.length) continue;

      // compute the Denver weekday name for this day (use first slot)
      const dayName = getDenverWeekdayName(slotList[0]); // e.g., "Friday"
      // find business hours for this weekday index
      const dayIndex = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].indexOf(dayName);
      const bh = (businessHours || []).find((b) => Number(b.day_of_week) === dayIndex);

      // if business closed that day -> skip whole day
      if (!bh || bh.is_open === false) continue;

      // available slots for this day (we'll filter down slotList)
      let available = slotList.slice();

      // 1. Filter by business hours (use Denver minutes)
      const storeOpen = toNumber(bh.open_time, null);
      const storeClose = toNumber(bh.close_time, null);
      available = available.filter((s) => {
        const slotMinutes = getMinutesInDenver(s);
        return isSlotInTimeRange(slotMinutes, storeOpen, storeClose);
      });

      // 2. Filter by barber hours (only if barber present)
      if (barberHours) {
        // Check if barber has weekend days off
        const barberWeekendDays = parseWeekendDays(barberHours.weekend_days);
        if (barberWeekendDays.includes(dayName)) {
          available = []; // barber weekend -> no slots this day
        } else {
          // Get barber hours for this specific day
          const dayStartKey = `${dayName}/Start Value`;
          const dayEndKey = `${dayName}/End Value`;
          const barberStart = toNumber(barberHours[dayStartKey], null);
          const barberEnd = toNumber(barberHours[dayEndKey], null);
          
          // Filter by barber's working hours for this day
          available = available.filter((s) => {
            const slotMinutes = getMinutesInDenver(s);
            return isSlotInTimeRange(slotMinutes, barberStart, barberEnd);
          });
          
          // Filter out lunch break if specified
          const lunchStart = toNumber(barberHours["Lunch/Start"], null);
          const lunchEnd = toNumber(barberHours["Lunch/End"], null);
          if (lunchStart !== null && lunchEnd !== null) {
            available = available.filter((s) => {
              const slotMinutes = getMinutesInDenver(s);
              return !isSlotInTimeRange(slotMinutes, lunchStart, lunchEnd);
            });
          }
        }
      }

      // 3. Filter by time_off (both store-level and barber-level)
      available = available.filter((s) => {
        return !(timeOffRows || []).some((timeOff) => {
          // Apply store-level time off (no ghl_id) or barber-specific time off
          const appliesTo = !timeOff.ghl_id || (userId && timeOff.ghl_id === userId);
          if (!appliesTo) return false;
          return isSlotDuringTimeOff(s, timeOff);
        });
      });

      // 4. Filter by time_block (both recurring and one-time blocks)
      available = available.filter((s) => {
        return !(timeBlockRows || []).some((timeBlock) => {
          // Apply store-level blocks (no ghl_id) or barber-specific blocks
          const appliesTo = !timeBlock.ghl_id || (userId && timeBlock.ghl_id === userId);
          if (!appliesTo) return false;
          return isSlotDuringTimeBlock(s, timeBlock);
        });
      });

      if (available.length) {
        // Format as 12-hour AM/PM in Denver and sort chronologically
        resultSlots[localDayKey] = available
          .sort((a,b) => new Date(a).getTime() - new Date(b).getTime())
          .map(formatSlotAs12h);
      }
    }

    const responseData = {
      calendarId,
      activeDay: "allDays",
      startDate: startDate.toISOString().split("T")[0],
      slots: resultSlots,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseData),
    };
  } catch (err) {
    console.error("❌ Error in Slots:", err.response?.data || err.message, err);
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
