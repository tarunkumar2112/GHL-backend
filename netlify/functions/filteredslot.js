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

// ✅ Load staff leaves from Supabase
async function getStaffLeaves(ghlId) {
  if (!ghlId) return {};

  const { data, error } = await supabase
    .from("staff_leaves")
    .select("*")
    .eq("ghl_id", ghlId)
    .eq("event_status", "Upcoming");

  if (error) {
    console.error("❌ Error loading staff_leaves:", error.message);
    throw error;
  }

  // Map date → { leave_type, start_time, end_time }
  const leaves = {};
  data.forEach((row) => {
    const dateStr = row.unavailable_date;
    leaves[dateStr] = {
      leave_type: row.leave_type,
      start_time: row.start_time ? Number(row.start_time.replace(":", "").slice(0, 4)) : null,
      end_time: row.end_time ? Number(row.end_time.replace(":", "").slice(0, 4)) : null,
    };
  });

  return leaves;
}

// ✅ Check if a time slot conflicts with staff leave
function isSlotBlockedByLeave(slotTime, leaveInfo) {
  if (!leaveInfo) return false;

  // Full day leave - block all slots
  if (leaveInfo.leave_type === "Full Day") {
    return true;
  }

  // Half day leave - check time range
  if (leaveInfo.leave_type === "Half Day") {
    const slotTimeNum = timeToNumberInTZ(slotTime, "America/Denver");
    return slotTimeNum >= leaveInfo.start_time && slotTimeNum <= leaveInfo.end_time;
  }

  return false;
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

    const { calendarId, userId, date, ghlId } = event.queryStringParameters || {};
    if (!calendarId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "calendarId parameter is required" }),
      };
    }

    // Load business hours and staff leaves from Supabase
    const [businessHours, staffLeaves] = await Promise.all([
      getBusinessHours(),
      getStaffLeaves(ghlId)
    ]);

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

    // ✅ Filter slots against business hours AND staff leaves
    const filterSlots = (slotsData) => {
      const filtered = {};
      Object.entries(slotsData).forEach(([dateStr, value]) => {
        if (dateStr === "traceId" || !value.slots?.length) return;

        const d = new Date(dateStr);
        const dayOfWeek = d.getDay(); // 0=Sun, 6=Sat
        const businessRule = businessHours[dayOfWeek];

        // Check business hours first
        if (!businessRule || !businessRule.is_open) return;

        // Check staff leave for this date
        const leaveInfo = staffLeaves[dateStr];
        
        // If full day leave, skip this entire date
        if (leaveInfo && leaveInfo.leave_type === "Full Day") {
          return;
        }

        const validSlots = value.slots
          .map((slot) => new Date(slot))
          .filter((dt) => {
            const num = timeToNumberInTZ(dt, "America/Denver");
            
            // Check business hours
            if (num < businessRule.start || num > businessRule.end) {
              return false;
            }

            // Check staff leave (half day)
            if (isSlotBlockedByLeave(dt, leaveInfo)) {
              return false;
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
      userId,
      ghlId,
      activeDay: "allDays",
      startDate: startDate.toISOString().split("T")[0],
      slots: filtered,
      filters: {
        businessHours: Object.keys(businessHours).length > 0,
        staffLeaves: Object.keys(staffLeaves).length > 0
      }
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseData),
    };
  } catch (err) {
    console.error("❌ Error in FilteredSlots:", err.response?.data || err.message);
    return {
      statusCode: err.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to fetch filtered slots",
        details: err.response?.data || err.message,
      }),
    };
  }
};
