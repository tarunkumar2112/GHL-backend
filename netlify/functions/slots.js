// slots.js
const axios = require("axios")
const { createClient } = require("@supabase/supabase-js")
const { getValidAccessToken } = require("../../supbase")

// Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Retry helper for 429
async function fetchWithRetry(url, headers, retries = 3, delay = 500) {
  try {
    return await axios.get(url, { headers })
  } catch (err) {
    if (err.response?.status === 429 && retries > 0) {
      console.warn(`429 received, retrying in ${delay}ms...`)
      await new Promise((r) => setTimeout(r, delay))
      return fetchWithRetry(url, headers, retries - 1, delay * 2)
    }
    throw err
  }
}

// Helper: get minutes in America/Denver for a given ISO slot string
function getMinutesInDenver(isoString) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(isoString))
  const hour = Number(parts.find((p) => p.type === "hour").value)
  const minute = Number(parts.find((p) => p.type === "minute").value)
  return hour * 60 + minute
}

// Helper: get date-key (YYYY-MM-DD) in America/Denver
function getDenverDateKey(isoString) {
  return new Date(isoString).toLocaleDateString("sv-SE", {
    timeZone: "America/Denver",
  })
}

// Helper: get weekday name in America/Denver (e.g., "Friday")
function getDenverWeekdayName(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "long",
  }).format(new Date(isoString))
}

// Helper: format slot as "03:15 AM"
function formatSlotAs12h(isoString) {
  return new Date(isoString).toLocaleString("en-US", {
    timeZone: "America/Denver",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

// Parse weekend_days robustly
function parseWeekendDays(val) {
  if (!val) return []
  if (Array.isArray(val)) return val.map(normalizeDayName)
  if (typeof val === "string") {
    try {
      // Handle JSON string format like "{\"Sunday\"}" or "{\"Saturday\",\"Sunday\"}"
      const parsed = JSON.parse(val)
      if (Array.isArray(parsed)) return parsed.map(normalizeDayName)
      // Handle object format like {"Sunday": true} or just "Sunday"
      if (typeof parsed === "object" && parsed !== null) {
        return Object.keys(parsed).map(normalizeDayName)
      }
      if (typeof parsed === "string") {
        return [normalizeDayName(parsed)]
      }
    } catch (e) {
      // Handle malformed JSON - try to extract day names
      console.log(`[v0] Parsing weekend_days manually: ${val}`)
      // Remove brackets, quotes, backslashes and split by common separators
      const cleaned = val.replace(/[{}[\]"\\]/g, "").trim()
      const parts = cleaned
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (parts.length > 0) {
        console.log(`[v0] Extracted weekend days: ${parts}`)
        return parts.map(normalizeDayName)
      }
    }
  }
  return []
}

function normalizeDayName(d) {
  if (!d) return d
  const s = String(d).trim()
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

// safe number parse
function toNumber(val, fallback = null) {
  if (val === null || val === undefined) return fallback
  const n = Number(val)
  return Number.isFinite(n) ? n : fallback
}

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" }
  }

  try {
    const accessToken = await getValidAccessToken()
    if (!accessToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Access token missing" }),
      }
    }

    const { calendarId, userId, date } = event.queryStringParameters || {}
    if (!calendarId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "calendarId parameter is required" }),
      }
    }

    console.log(`Processing slots for calendarId: ${calendarId}, userId: ${userId}`)

    // fetch GHL slots (raw)
    const fetchSlots = async (start, end) => {
      let url = `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}`
      if (userId) url += `&userId=${userId}`
      const response = await fetchWithRetry(url, {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-04-15",
      })
      return response.data
    }

    // date range (30 days)
    let startDate = new Date()
    if (date) {
      const parts = date.split("-")
      if (parts.length === 3) {
        startDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
      }
    }

    const totalDays = 30
    const daysToCheck = []
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate)
      d.setDate(startDate.getDate() + i)
      daysToCheck.push(d)
    }

    const startOfRange = new Date(
      daysToCheck[0].getFullYear(),
      daysToCheck[0].getMonth(),
      daysToCheck[0].getDate(),
      0,
      0,
      0,
      0,
    ).getTime()
    const endOfRange = new Date(
      daysToCheck[daysToCheck.length - 1].getFullYear(),
      daysToCheck[daysToCheck.length - 1].getMonth(),
      daysToCheck[daysToCheck.length - 1].getDate(),
      23,
      59,
      59,
      999,
    ).getTime()

    const rawSlotsData = await fetchSlots(startOfRange, endOfRange)

    // fetch rules
    const { data: businessHours } = await supabase.from("business_hours").select("*")

    let barberHours = null,
      timeOffRows = [],
      timeBlockRows = []
    if (userId) {
      console.log(`Fetching barber data for userId: ${userId}`)

      // Try to find barber hours with exact match first
      let { data: barberData, error: barberError } = await supabase.from("barber_hours").select("*").eq("ghl_id", userId).maybeSingle()
      
      // If not found, try with common typo variations (I vs 1, O vs 0)
      if (!barberData && userId) {
        const variations = [
          userId.replace(/1/g, 'I').replace(/0/g, 'O'), // 1->I, 0->O
          userId.replace(/I/g, '1').replace(/O/g, '0'), // I->1, O->0
          userId.replace(/1/g, 'I'), // 1->I only
          userId.replace(/I/g, '1'), // I->1 only
        ].filter(v => v !== userId) // Remove original to avoid duplicate queries
        
        console.log(`Trying ${variations.length} variations for userId: ${userId}`)
        console.log(`Variations: ${variations.join(', ')}`)
        for (const variation of variations) {
          console.log(`Trying barber hours with variation: ${variation}`)
          const { data: altData } = await supabase.from("barber_hours").select("*").eq("ghl_id", variation).maybeSingle()
          if (altData) {
            barberData = altData
            console.log(`Found barber hours with variation: ${variation}`)
            break
          } else {
            console.log(`No data found for variation: ${variation}`)
          }
        }
      }
      
      barberHours = barberData || null

      console.log(`Found barber hours:`, barberHours ? "Yes" : "No")
      if (barberError) {
        console.error(`Error fetching barber hours:`, barberError)
      }

      const { data: timeOffData, error: timeOffError } = await supabase.from("time_off").select("*").or(`ghl_id.eq.${userId},ghl_id.is.null`)
      timeOffRows = timeOffData || []

      console.log(`Found ${timeOffRows.length} time_off records`)
      if (timeOffError) {
        console.error(`Error fetching time_off:`, timeOffError)
      }

      const { data: timeBlockData, error: timeBlockError } = await supabase
        .from("time_block")
        .select("*")
        .or(`ghl_id.eq.${userId},ghl_id.is.null`)
      timeBlockRows = timeBlockData || []

      console.log(`Found ${timeBlockRows.length} time_block records`)
      if (timeBlockError) {
        console.error(`Error fetching time_block:`, timeBlockError)
      }
    }

    // group raw slots
    const buckets = {}
    for (const [key, val] of Object.entries(rawSlotsData || {})) {
      if (key === "traceId") continue
      const arr = val?.slots || []
      for (const s of arr) {
        const localDay = getDenverDateKey(s)
        if (!buckets[localDay]) buckets[localDay] = []
        buckets[localDay].push(s)
      }
    }

    const resultSlots = {}
    const barberWeekendDays = barberHours ? parseWeekendDays(barberHours.weekend_days) : []

    console.log(`Barber weekend days:`, barberWeekendDays)
    console.log(`Barber weekend days raw:`, barberHours?.weekend_days)

    for (const [localDayKey, slotList] of Object.entries(buckets)) {
      if (!slotList.length) continue

      const dayName = getDenverWeekdayName(slotList[0])
      const dayIndex = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(dayName)
      const bh = (businessHours || []).find((b) => Number(b.day_of_week) === dayIndex)

      if (!bh || bh.is_open === false) {
        console.log(`Skipping ${localDayKey} (${dayName}) - business closed`)
        continue
      }

      let available = slotList.slice()
      console.log(`Processing ${localDayKey} (${dayName}) - ${available.length} initial slots`)

      // store hours (always apply)
      const storeOpen = toNumber(bh.open_time, null)
      const storeClose = toNumber(bh.close_time, null)
      if (storeOpen !== null && storeClose !== null) {
        const beforeFilter = available.length
        available = available.filter((s) => {
          const m = getMinutesInDenver(s)
          return m >= storeOpen && m <= storeClose
        })
        console.log(`Business hours filter: ${beforeFilter} -> ${available.length} slots`)
      }

      // if no userId, stop here
      if (!userId) {
        if (available.length) {
          resultSlots[localDayKey] = available
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
            .map(formatSlotAs12h)
        }
        continue
      }

      // barber hours
      if (barberHours) {
        console.log(`[v0] Applying barber hours for ${dayName}`)
        console.log(
          `[v0] Barber weekend days check: ${dayName} in [${barberWeekendDays.join(", ")}] = ${barberWeekendDays.includes(dayName)}`,
        )

        if (barberWeekendDays.includes(dayName)) {
          console.log(`[v0] ${dayName} is barber's weekend - blocking all slots`)
          available = []
        } else {
          const startKey = `${dayName}/Start Value`
          const endKey = `${dayName}/End Value`
          const bhStart = toNumber(barberHours[startKey], null)
          const bhEnd = toNumber(barberHours[endKey], null)

          console.log(`Barber hours for ${dayName}: ${bhStart} - ${bhEnd}`)

          if (bhStart !== null && bhEnd !== null) {
            const beforeFilter = available.length
            available = available.filter((s) => {
              const m = getMinutesInDenver(s)
              return m >= bhStart && m <= bhEnd
            })
            console.log(`Barber hours filter: ${beforeFilter} -> ${available.length} slots`)
          }

          const lunchStart =
            toNumber(barberHours["Lunch/Start"], null) || toNumber(barberHours["Lunch/Start Value"], null)
          const lunchEnd = toNumber(barberHours["Lunch/End"], null) || toNumber(barberHours["Lunch/End Value"], null)
          if (lunchStart !== null && lunchEnd !== null) {
            const beforeFilter = available.length
            available = available.filter((s) => {
              const m = getMinutesInDenver(s)
              return !(m >= lunchStart && m <= lunchEnd)
            })
            console.log(`Lunch break filter: ${beforeFilter} -> ${available.length} slots`)
          }
        }
      }

      if (timeOffRows.length) {
        const beforeFilter = available.length
        available = available.filter((s) => {
          const slotTime = new Date(s).getTime()
          const slotDateKey = getDenverDateKey(s)

          return !timeOffRows.some((t) => {
            // Check if this time-off applies to this barber or is store-level
            const appliesTo = !t.ghl_id || (userId && t.ghl_id === userId)
            if (!appliesTo) return false

            let startTime, endTime, startDateKey, endDateKey
            try {
              // Handle different date formats like '9/17/2025, 12:00:00 AM'
              const startDateStr = t["Event/Start"]
              const endDateStr = t["Event/End"]
              
              // Parse dates more robustly
              let startDate, endDate
              if (startDateStr.includes(',')) {
                // Format: '9/17/2025, 12:00:00 AM'
                const [datePart] = startDateStr.split(',')
                startDate = new Date(datePart.trim())
              } else {
                startDate = new Date(startDateStr)
              }
              
              if (endDateStr.includes(',')) {
                // Format: '9/18/2025, 12:00:00 AM'
                const [datePart] = endDateStr.split(',')
                endDate = new Date(datePart.trim())
              } else {
                endDate = new Date(endDateStr)
              }

              startTime = startDate.getTime()
              endTime = endDate.getTime()

              // Get date keys for comparison
              startDateKey = startDate.toLocaleDateString("sv-SE", { timeZone: "America/Denver" })
              endDateKey = endDate.toLocaleDateString("sv-SE", { timeZone: "America/Denver" })
            } catch (e) {
              console.warn(`Invalid time_off date format:`, t["Event/Start"], t["Event/End"], e.message)
              return false
            }

            // Check if slot date falls within time-off date range (inclusive)
            const isDateBlocked = slotDateKey >= startDateKey && slotDateKey <= endDateKey

            if (isDateBlocked) {
              console.log(
                `Slot blocked by time_off: ${s} on ${slotDateKey} (${t["Event/Name"]} from ${startDateKey} to ${endDateKey})`,
              )
              return true
            }

            return false
          })
        })
        console.log(`Time-off filter: ${beforeFilter} -> ${available.length} slots`)
      }

      if (timeBlockRows.length) {
        const beforeFilter = available.length
        available = available.filter((s) => {
          const m = getMinutesInDenver(s)
          const slotDay = getDenverDateKey(s)
          const slotWeekday = getDenverWeekdayName(s)

          return !timeBlockRows.some((tb) => {
            // Check if this time-block applies to this barber or is store-level
            const appliesTo = !tb.ghl_id || (userId && tb.ghl_id === userId)
            if (!appliesTo) return false

            const blockStart = toNumber(tb["Block/Start"], null)
            const blockEnd = toNumber(tb["Block/End"], null)
            const recurringRaw = tb["Block/Recurring"]
            const recurring = String(recurringRaw).toLowerCase() === "true"

            if (recurring) {
              // For recurring blocks, check if weekday matches
              const recurringDay = normalizeDayName(tb["Block/Recurring Day"])
              if (recurringDay === slotWeekday && blockStart !== null && blockEnd !== null) {
                const isBlocked = m >= blockStart && m <= blockEnd
                if (isBlocked) {
                  console.log(`Slot blocked by recurring time_block: ${s} (${tb["Block/Name"]} on ${recurringDay})`)
                }
                return isBlocked
              }
              return false
            } else {
              // For non-recurring blocks, check specific date
              if (!tb["Block/Date"]) return false

              // Parse the block date properly with better error handling
              let blockDateKey
              try {
                const blockDateStr = tb["Block/Date"]
                let blockDate
                
                if (blockDateStr.includes(',')) {
                  // Format: '7/26/2025, 12:00:00 AM'
                  const [datePart] = blockDateStr.split(',')
                  blockDate = new Date(datePart.trim())
                } else {
                  blockDate = new Date(blockDateStr)
                }
                
                blockDateKey = blockDate.toLocaleDateString("sv-SE", {
                  timeZone: "America/Denver",
                })
              } catch (e) {
                console.warn(`Invalid time_block date format:`, tb["Block/Date"], e.message)
                return false
              }

              if (blockDateKey === slotDay && blockStart !== null && blockEnd !== null) {
                const isBlocked = m >= blockStart && m <= blockEnd
                if (isBlocked) {
                  console.log(`Slot blocked by specific time_block: ${s} on ${blockDateKey} (${tb["Block/Name"]})`)
                }
                return isBlocked
              }
              return false
            }
          })
        })
        console.log(`Time-block filter: ${beforeFilter} -> ${available.length} slots`)
      }

      if (available.length) {
        resultSlots[localDayKey] = available
          .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
          .map(formatSlotAs12h)
      }
    }

    const responseData = {
      calendarId,
      activeDay: "allDays",
      startDate: startDate.toISOString().split("T")[0],
      slots: resultSlots,
      debug: {
        barberFound: !!barberHours,
        timeOffCount: timeOffRows.length,
        timeBlockCount: timeBlockRows.length,
        barberWeekendDays: barberWeekendDays,
        userId: userId,
        version: "v2.1"
      }
    }

    console.log(`Final result: ${Object.keys(resultSlots).length} days with slots`)

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseData),
    }
  } catch (err) {
    console.error("❌ Error in Slots:", err.response?.data || err.message, err)
    return {
      statusCode: err.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to fetch slots",
        details: err.response?.data || err.message,
      }),
    }
  }
}
