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

// ✅ Convert a Date → minutes since midnight in specific timezone (America/Denver)
function timeToMinutesInTZ(date, tz = "America/Denver") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour").value);
  const minute = Number(parts.find((p) => p.type === "minute").value);
  return hour * 60 + minute;
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
    const ghlId = row.ghl_id?.trim();
    if (!ghlId) return;

    // Parse weekend days
    let weekendDays = [];
    if (row.weekend_days) {
      try {
        const parsed = JSON.parse(row.weekend_days.replace(/'/g, '"'));
        weekendDays = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.warn(`Failed to parse weekend_days for ${ghlId}:`, row.weekend_days);
      }
    }

    barberHours[ghlId] = {
      Monday: { 
        start: Number(row["Monday/Start Value"]) || 0, 
        end: Number(row["Monday/End Value"]) || 0,
        isWeekend: weekendDays.includes("Monday")
      },
      Tuesday: { 
        start: Number(row["Tuesday/Start Value"]) || 0, 
        end: Number(row["Tuesday/End Value"]) || 0,
        isWeekend: weekendDays.includes("Tuesday")
      },
      Wednesday: { 
        start: Number(row["Wednesday/Start Value"]) || 0, 
        end: Number(row["Wednesday/End Value"]) || 0,
        isWeekend: weekendDays.includes("Wednesday")
      },
      Thursday: { 
        start: Number(row["Thursday/Start Value"]) || 0, 
        end: Number(row["Thursday/End Value"]) || 0,
        isWeekend: weekendDays.includes("Thursday")
      },
      Friday: { 
        start: Number(row["Friday/Start Value"]) || 0, 
        end: Number(row["Friday/End Value"]) || 0,
        isWeekend: weekendDays.includes("Friday")
      },
      Saturday: { 
        start: Number(row["Saturday/Start Value"]) || 0, 
        end: Number(row["Saturday/End Value"]) || 0,
        isWeekend: weekendDays.includes("Saturday")
      },
      Sunday: { 
        start: Number(row["Sunday/Start Value"]) || 0, 
        end: Number(row["Sunday/End Value"]) || 0,
        isWeekend: weekendDays.includes("Sunday")
      },
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
    const eventBarberId = entry.ghl_id?.trim();
    
    // If barber ID is specified in time off and doesn't match current barber, skip
    if (eventBarberId && eventBarberId !== barberId) {
      return false;
    }

    // Parse dates properly - handle different date formats
    let startDate, endDate;
    try {
      startDate = new Date(entry["Event/Start"]);
      endDate = new Date(entry["Event/End"]);
      console.log(`📅 Parsed time off dates: start=${startDate.toISOString()}, end=${endDate.toISOString()}`);
    } catch (e) {
      console.warn(`Failed to parse time off dates:`, entry["Event/Start"], entry["Event/End"]);
      return false;
    }
    
    // Check if slot date falls within the time off period
    const slotDateOnly = new Date(slotDate.getFullYear(), slotDate.getMonth(), slotDate.getDate());
    const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    
    const isInTimeOff = slotDateOnly >= startDateOnly && slotDateOnly < endDateOnly;
    
    if (isInTimeOff) {
      console.log(`🚫 Time off match: ${slotDateOnly.toISOString().split('T')[0]} is in time off period ${startDateOnly.toISOString().split('T')[0]} to ${endDateOnly.toISOString().split('T')[0]} for barber ${eventBarberId}`);
    }
    
    return isInTimeOff;
  });
}

// ✅ Check if a slot falls into time blocks (recurring or not)
function isInTimeBlock(slotDate, slotMinutes, timeBlocks, barberId) {
  return timeBlocks.some((block) => {
    const blockBarberId = block.ghl_id?.trim();
    
    // If barber ID is specified in time block and doesn't match current barber, skip
    if (blockBarberId && blockBarberId !== barberId) {
      return false;
    }

    // Check if it's a recurring block
    if (block["Block/Recurring"] === "true") {
      const recurringDay = block["Block/Recurring Day"]?.trim();
      if (!recurringDay) return false;
      
      const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayName = weekdays[slotDate.getDay()];
      
      if (recurringDay !== dayName) {
        return false;
      }
    } else {
      // Non-recurring block - check specific date
      let blockDate;
      try {
        blockDate = new Date(block["Block/Date"]);
      } catch (e) {
        console.warn(`Failed to parse block date:`, block["Block/Date"]);
        return false;
      }
      
      const slotDateOnly = new Date(slotDate.getFullYear(), slotDate.getMonth(), slotDate.getDate());
      const blockDateOnly = new Date(blockDate.getFullYear(), blockDate.getMonth(), blockDate.getDate());
      
      if (slotDateOnly.getTime() !== blockDateOnly.getTime()) {
        return false;
      }
    }

    // Check if slot time falls within the blocked time range
    const blockStart = Number(block["Block/Start"]) || 0;
    const blockEnd = Number(block["Block/End"]) || 0;
    
    const isInBlock = isWithinTimeRange(slotMinutes, blockStart, blockEnd);
    
    if (isInBlock) {
      console.log(`🚫 Time block match: ${slotDate.toISOString().split('T')[0]} at ${Math.floor(slotMinutes/60)}:${(slotMinutes%60).toString().padStart(2,'0')} is in block ${blockStart}-${blockEnd} for barber ${blockBarberId}`);
    }
    
    return isInBlock;
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

    // Check business hours
    const bh = businessHours[dayOfWeek];
    if (!bh || !bh.is_open) {
      console.log(`🚫 Business closed on ${dayName} (day ${dayOfWeek})`);
      return;
    }

    const validSlots = value.slots
      .map((slot) => new Date(slot))
      .filter((dt) => {
        const slotMinutes = timeToMinutesInTZ(dt, "America/Denver");
        
        // Debug: Log first few slots for each day
        if (value.slots.indexOf(dt.toISOString()) < 3) {
          console.log(`🔍 Processing slot: ${dt.toISOString()} (${dayName}) at ${Math.floor(slotMinutes/60)}:${(slotMinutes%60).toString().padStart(2,'0')}`);
        }

        // Business hours check
        if (!isWithinTimeRange(slotMinutes, bh.start, bh.end)) {
          if (value.slots.indexOf(dt.toISOString()) < 3) {
            console.log(`❌ Outside business hours: ${Math.floor(slotMinutes/60)}:${(slotMinutes%60).toString().padStart(2,'0')} not in ${bh.start}-${bh.end}`);
          }
          return false;
        }

        if (barberId) {
          const barHours = barberHours[barberId]?.[dayName];
          if (!barHours) {
            console.log(`❌ No barber hours found for ${barberId} on ${dayName}`);
            return false;
          }

          // Check if this is a weekend day for the barber
          if (barHours.isWeekend) {
            console.log(`🚫 Weekend day for barber ${barberId}: ${dayName} is marked as weekend`);
            return false;
          }

          // Check barber working hours
          if (!isWithinTimeRange(slotMinutes, barHours.start, barHours.end)) {
            console.log(`❌ Outside barber hours: ${Math.floor(slotMinutes/60)}:${(slotMinutes%60).toString().padStart(2,'0')} not in ${barHours.start}-${barHours.end} for ${barberId}`);
            return false;
          }
          
          // Check time off
          if (isInTimeOff(dt, slotMinutes, timeOffList, barberId)) {
            return false;
          }
          
          // Check time blocks
          if (isInTimeBlock(dt, slotMinutes, timeBlocks, barberId)) {
            return false;
          }
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

    const { calendarId, barberId, userId, date } = event.queryStringParameters || {};
    if (!calendarId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "calendarId parameter is required" }),
      };
    }

    // Use userId as barberId if barberId is not provided
    const actualBarberId = barberId || userId;

    console.log(`🔍 Processing slots request: calendarId=${calendarId}, barberId=${barberId}, userId=${userId}, actualBarberId=${actualBarberId}, date=${date}`);

    // Load all required data
    const [businessHours, barberHours, timeOffList, timeBlocks] = await Promise.all([
      getBusinessHours(),
      getBarberHours(),
      getTimeOff(),
      getTimeBlock()
    ]);

    console.log(`📊 Loaded data: businessHours=${Object.keys(businessHours).length} days, barberHours=${Object.keys(barberHours).length} barbers, timeOff=${timeOffList.length} entries, timeBlocks=${timeBlocks.length} entries`);
    
    // Debug barber hours for the specific barber
    if (actualBarberId && barberHours[actualBarberId]) {
      console.log(`👤 Barber ${actualBarberId} hours:`, JSON.stringify(barberHours[actualBarberId], null, 2));
    } else if (actualBarberId) {
      console.log(`❌ No barber hours found for ${actualBarberId}. Available barbers:`, Object.keys(barberHours));
    }
    
    // Debug time off entries
    if (timeOffList.length > 0) {
      console.log(`🚫 Time off entries:`, timeOffList.map(entry => ({
        barber: entry.ghl_id?.trim(),
        start: entry["Event/Start"],
        end: entry["Event/End"]
      })));
    }
    
    // Debug time blocks
    if (timeBlocks.length > 0) {
      console.log(`🚧 Time blocks:`, timeBlocks.map(block => ({
        barber: block.ghl_id?.trim(),
        recurring: block["Block/Recurring"],
        day: block["Block/Recurring Day"],
        date: block["Block/Date"],
        start: block["Block/Start"],
        end: block["Block/End"]
      })));
    }

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

    // Fetch slots from GHL API
    const slotsUrl = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${startOfRange}&endDate=${endOfRange}${actualBarberId ? `&userId=${actualBarberId}` : ''}`;
    console.log(`🌐 Fetching slots from: ${slotsUrl}`);
    
    const slotsData = await fetchWithRetry(
      slotsUrl,
      { Authorization: `Bearer ${accessToken}`, Version: "2021-04-15" }
    ).then(res => res.data);

    console.log(`📅 Raw slots data keys: ${Object.keys(slotsData).filter(k => k !== 'traceId').join(', ')}`);

    const filtered = filterSlots(slotsData, businessHours, barberHours, timeOffList, timeBlocks, actualBarberId);

    console.log(`✅ Filtered slots for ${Object.keys(filtered).length} days`);

    const responseData = {
      calendarId,
      barberId: actualBarberId || null,
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
