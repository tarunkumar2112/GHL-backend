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

  if (modifier === "PM" && hours !== 12) hours += 12;
  if (modifier === "AM" && hours === 12) hours = 0;
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

    const startOfRange = new Date(daysToCheck[0].getFullYear(), daysToCheck[0].getMonth(), daysToCheck[0].getDate(), 0, 0, 0);
    const endOfRange = new Date(daysToCheck[daysToCheck.length - 1].getFullYear(), daysToCheck[daysToCheck.length - 1].getMonth(), daysToCheck[daysToCheck.length - 1].getDate(), 23, 59, 59);

    const fetchSlots = async () => {
      const url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${startOfRange.getTime()}&endDate=${endOfRange.getTime()}`;
      const response = await fetchWithRetry(url, {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-04-15"
      });
      return response.data;
    };
    const slotsData = await fetchSlots();

    // Fetch business hours
    const { data: businessHoursData, error: bhError } = await supabase
      .from("business_hours")
      .select("*")
      .eq("is_open", true);
    if (bhError) throw new Error("Failed to fetch business hours");

    const businessHoursMap = {};
    businessHoursData.forEach(item => {
      businessHoursMap[item.day_of_week] = item;
    });

    // Fetch barber hours
    let barberHoursMap = {};
    let barberWeekends = [];
    let barberWeekendIndexes = [];

    if (userId) {
      const { data: barberData, error: barberError } = await supabase
        .from("barber_hours")
        .select("*")
        .eq("ghl_id", userId)
        .single();
      if (barberError) throw new Error("Failed to fetch barber hours");

      // Parse weekend_days
      if (barberData.weekend_days) {
        try {
          let weekendString = barberData.weekend_days.replace(/^['"]|['"]$/g, '');
          if (weekendString.includes('{') && weekendString.includes('}')) {
            weekendString = weekendString.replace(/^['"]*\{/, '[').replace(/\}['"]*.*$/, ']').replace(/\\"/g, '"');
          }
          barberWeekends = JSON.parse(weekendString);
        } catch (e) {
          console.error("Failed to parse weekend_days:", e.message);
          barberWeekends = [];
        }
      }

      const dayNameToIndex = { "Sunday":0,"Monday":1,"Tuesday":2,"Wednesday":3,"Thursday":4,"Friday":5,"Saturday":6 };
      barberWeekendIndexes = barberWeekends.map(day => dayNameToIndex[day]).filter(v => v !== undefined);

      barberHoursMap = {
        0: { start: parseInt(barberData["Sunday/Start Value"]) || 0, end: parseInt(barberData["Sunday/End Value"]) || 0 },
        1: { start: parseInt(barberData["Monday/Start Value"]) || 0, end: parseInt(barberData["Monday/End Value"]) || 0 },
        2: { start: parseInt(barberData["Tuesday/Start Value"]) || 0, end: parseInt(barberData["Tuesday/End Value"]) || 0 },
        3: { start: parseInt(barberData["Wednesday/Start Value"]) || 0, end: parseInt(barberData["Wednesday/End Value"]) || 0 },
        4: { start: parseInt(barberData["Thursday/Start Value"]) || 0, end: parseInt(barberData["Thursday/End Value"]) || 0 },
        5: { start: parseInt(barberData["Friday/Start Value"]) || 0, end: parseInt(barberData["Friday/End Value"]) || 0 },
        6: { start: parseInt(barberData["Saturday/Start Value"]) || 0, end: parseInt(barberData["Saturday/End Value"]) || 0 }
      };
    }

    // Fetch time off
    let timeOffList = [];
    if (userId) {
      const { data: timeOffData } = await supabase.from("time_off").select("*").eq("ghl_id", userId);
      timeOffList = (timeOffData || []).map(item => ({
        start: new Date(item["Event/Start"]),
        end: new Date(item["Event/End"])
      }));
    }
    const isDateInTimeOff = (date) => {
      for (const period of timeOffList) {
        const start = new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate());
        const end = new Date(period.end.getFullYear(), period.end.getMonth(), period.end.getDate());
        if (date >= start && date < end) return true;
      }
      return false;
    };

    // Fetch time blocks
    let timeBlockList = [];
    if (userId) {
      const { data: blockData } = await supabase.from("time_block").select("*").eq("ghl_id", userId);
      timeBlockList = (blockData || []).map(item => ({
        start: parseInt(item["Block/Start"]),
        end: parseInt(item["Block/End"]),
        date: item["Block/Date"] ? new Date(item["Block/Date"]) : null,
        recurring: item["Block/Recurring"] === true || item["Block/Recurring"] === "true",
        recurringDay: item["Block/Recurring Day"]
      }));
    }

    const isSlotBlocked = (slotDate, slotMinutes) => {
      for (const block of timeBlockList) {
        if (block.recurring) {
          const dayNameToIndex = { "Sunday":0,"Monday":1,"Tuesday":2,"Wednesday":3,"Thursday":4,"Friday":5,"Saturday":6 };
          if (dayNameToIndex[block.recurringDay] === slotDate.getDay()) {
            if (isWithinRange(slotMinutes, block.start, block.end)) return true;
          }
        } else if (block.date) {
          const blockDate = new Date(block.date.getFullYear(), block.date.getMonth(), block.date.getDate());
          const currDate = new Date(slotDate.getFullYear(), slotDate.getMonth(), slotDate.getDate());
          if (+blockDate === +currDate && isWithinRange(slotMinutes, block.start, block.end)) return true;
        }
      }
      return false;
    };

    const filteredSlots = {};
    for (const day of daysToCheck) {
      const dateKey = day.toISOString().split("T")[0];
      const dayOfWeek = day.getDay();

      const bh = businessHoursMap[dayOfWeek];
      if (!bh) continue;
      const openTime = bh.open_time;
      const closeTime = bh.close_time;

      let validSlots = slotsData[dateKey]?.slots || [];

      validSlots = validSlots.filter(slot => {
        const timeString = new Date(slot).toLocaleString("en-US", {
          timeZone: "America/Denver",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true
        });
        const minutes = timeToMinutes(timeString);
        return isWithinRange(minutes, openTime, closeTime);
      });

      if (userId) {
        // Skip barber weekend
        if (barberWeekendIndexes.includes(dayOfWeek)) continue;

        const barberHours = barberHoursMap[dayOfWeek];
        if (!barberHours || (barberHours.start === 0 && barberHours.end === 0)) continue;

        if (isDateInTimeOff(day)) continue;

        validSlots = validSlots.filter(slot => {
          const timeString = new Date(slot).toLocaleString("en-US", {
            timeZone: "America/Denver",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
          });
          const minutes = timeToMinutes(timeString);
          return isWithinRange(minutes, barberHours.start, barberHours.end) && !isSlotBlocked(day, minutes);
        });
      }

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
        slots: filteredSlots,
        debug: userId ? {
          barberWeekends,
          barberWeekendIndexes,
          barberHoursMap,
          timeOffList,
          timeBlockList
        } : undefined
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
