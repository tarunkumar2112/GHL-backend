const axios = require("axios");
const { getValidAccessToken } = require("../../supbase");
import * as glide from "@glideapps/tables";

// 🔹 Glide table config
const dataTradingHours1Table = glide.table({
  token: "aa5c5a76-fb8a-440a-853a-77da3c9200a6",
  app: "s3S0ts3gGHAWo9BXfcJY",
  table: "native-table-hsus2D3G9gILrXrqlA5P",
  columns: {
    jsonSummary: { type: "string", name: "fiEyB" },
    dayName: { type: "string", name: "Xpoal" },
    dayStart: { type: "number", name: "wcwmd" },
    dayEnd: { type: "number", name: "22Jaw" },
  },
});

// 🔄 Retry helper
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

// 🔹 Parse "HH:MM AM/PM" -> number like 930, 1530 etc.
function timeToNumber(date) {
  const hours = date.getHours();
  const mins = date.getMinutes();
  return hours * 100 + mins;
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

    // ✅ Get trading hours from Glide
    const tradingRows = await dataTradingHours1Table.get();
    const tradingHours = {};
    tradingRows.forEach((row) => {
      tradingHours[row.dayName] = {
        start: row.dayStart,
        end: row.dayEnd,
      };
    });

    // 🔹 Fetch slots from GHL
    const fetchSlots = async (start, end) => {
      let url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}`;
      if (userId) url += `&userId=${userId}`;

      const response = await fetchWithRetry(url, {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-04-15",
      });
      return response.data;
    };

    // 🔹 Format + filter by trading hours
    const formatAndFilterSlots = (slotsData) => {
      const formatted = {};
      Object.entries(slotsData).forEach(([dateStr, value]) => {
        if (dateStr === "traceId") return;
        if (!value.slots?.length) return;

        const d = new Date(dateStr);
        const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
        const rule = tradingHours[dayName];
        if (!rule) return;

        const filteredSlots = value.slots
          .map((slot) => new Date(slot))
          .filter((dt) => {
            const num = timeToNumber(dt);
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

        if (filteredSlots.length > 0) {
          formatted[dateStr] = filteredSlots;
        }
      });
      return formatted;
    };

    const getDayRange = (day) => ({
      start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).getTime(),
      end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).getTime(),
    });

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

    const { start: startOfRange } = getDayRange(daysToCheck[0]);
    const { end: endOfRange } = getDayRange(daysToCheck[daysToCheck.length - 1]);

    const slotsData = await fetchSlots(startOfRange, endOfRange);
    const allFiltered = formatAndFilterSlots(slotsData);

    const filtered = {};
    daysToCheck.forEach((d) => {
      const key = d.toISOString().split("T")[0];
      if (allFiltered[key]) {
        filtered[key] = allFiltered[key];
      }
    });

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
    console.error("❌ Error in FilteredTradingSlots:", err.response?.data || err.message);
    return {
      statusCode: err.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to fetch trading slots",
        details: err.response?.data || err.message,
      }),
    };
  }
};
