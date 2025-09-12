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
    // barber_hours (maybeSingle returns null if not found)
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

    // pre-parse barber weekend days
    const barberWeekendDays = barberHours ? parseWeekendDays(barberHours.weekend_days) : [];

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

      // filter by business hours (use Denver minutes)
      const storeOpen = toNumber(bh.open_time, null);
      const storeClose = toNumber(bh.close_time, null);
      if (storeOpen !== null && storeClose !== null) {
        available = available.filter((s) => {
          const m = getMinutesInDenver(s);
          // allow slot if it's within [open, close). use close exclusive
          return m >= storeOpen && m < storeClose;
        });
      }

      // barber hours (only if barber present)
      if (barberHours) {
        // weekend check (parsed)
        if (barberWeekendDays.includes(dayName)) {
          available = []; // barber weekend -> no slots this day
        } else {
          // try to read start/end for that weekday from barber_hours columns
          const startKey = `${dayName}/Start Value`;
          const endKey = `${dayName}/End Value`;
          const bhStart = toNumber(barberHours[startKey], null);
          const bhEnd = toNumber(barberHours[endKey], null);

          if (bhStart !== null && bhEnd !== null) {
            available = available.filter((s) => {
              const m = getMinutesInDenver(s);
              return m >= bhStart && m < bhEnd;
            });
          } else {
            // if barber does not have explicit hours for day => keep existing (fallback to store hours)
          }

          // optional: lunch filter if Lunch/Start and Lunch/End exist (not applied unless present)
          const lunchStart = toNumber(barberHours["Lunch/Start"], null) || toNumber(barberHours["Lunch/Start Value"], null);
          const lunchEnd = toNumber(barberHours["Lunch/End"], null) || toNumber(barberHours["Lunch/End Value"], null);
          if (lunchStart !== null && lunchEnd !== null) {
            available = available.filter((s) => {
              const m = getMinutesInDenver(s);
              return !(m >= lunchStart && m < lunchEnd); // remove lunch window
            });
          }
        }
      }

      // filter by time_off (applies if no ghl_id OR ghl_id === userId)
      available = available.filter((s) => {
        const ts = new Date(s).getTime();
        return !( (timeOffRows || []).some((t) => {
          const appliesTo = !t.ghl_id || (userId && t.ghl_id === userId);
          if (!appliesTo) return false;
          const start = new Date(t["Event/Start"]).getTime();
          const end = new Date(t["Event/End"]).getTime();
          return ts >= start && ts < end;
        }) );
      });

      // filter by time_block (recurring & one-time). Only apply blocks that are global or target the user
      available = available.filter((s) => {
        const m = getMinutesInDenver(s);
        const slotDay = getDenverDateKey(s); // YYYY-MM-DD
        const slotWeekday = getDenverWeekdayName(s);
        return !((timeBlockRows || []).some((tb) => {
          const appliesTo = !tb.ghl_id || (userId && tb.ghl_id === userId);
          if (!appliesTo) return false;

          const blockStart = toNumber(tb["Block/Start"], null);
          const blockEnd = toNumber(tb["Block/End"], null);
          const recurringRaw = tb["Block/Recurring"];
          const recurring = String(recurringRaw).toLowerCase() === "true";
          if (recurring) {
            const recurringDay = normalizeDayName(tb["Block/Recurring Day"]);
            if (!recurringDay) return false;
            if (recurringDay === slotWeekday && blockStart !== null && blockEnd !== null) {
              return m >= blockStart && m < blockEnd;
            }
            return false;
          } else {
            // non-recurring: match by block date (compare Denver day)
            if (!tb["Block/Date"]) return false;
            const blockDateKey = new Date(tb["Block/Date"]).toLocaleDateString("sv-SE", { timeZone: "America/Denver" });
            if (blockDateKey === slotDay && blockStart !== null && blockEnd !== null) {
              return m >= blockStart && m < blockEnd;
            }
            return false;
          }
        }));
      });

      if (available.length) {
        // format as 12-hour AM/PM in Denver (like workingSlots)
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
