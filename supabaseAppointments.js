// supabaseAppointments.js
const { createClient } = require("@supabase/supabase-js")

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * Save or update a booking in Supabase
 * @param {Object} booking
 */
async function saveBookingToDB(booking) {
  try {
    console.log("📝 Attempting to save booking:", JSON.stringify(booking, null, 2))

    const mappedBooking = {
      id: booking.id,
      calendar_id: booking.calendarId || null,
      contact_id: booking.contactId || null, // 🔗 foreign key
      title: booking.title || null,
      status: booking.status || null,
      appointment_status: booking.appoinmentStatus || booking.appointmentStatus || null,
      assigned_user_id: booking.assignedUserId || null,
      address: booking.address || null,
      is_recurring: booking.isRecurring || false,
      trace_id: booking.traceId || null,
    }

    console.log("🗂️ Mapped booking for DB:", JSON.stringify(mappedBooking, null, 2))

    // ✅ Insert as array
    const { data, error } = await supabase.from("restyle_bookings").insert([mappedBooking]).select()

    if (error) {
      console.error("❌ Supabase error details:", error)
      throw new Error(`Supabase error: ${error.message} (Code: ${error.code})`)
    }

    console.log("✅ Successfully saved booking to DB:", data)
    return data
  } catch (err) {
    console.error("❌ Error saving booking to DB:", err.message)
    console.error("❌ Full error:", err)
    throw err
  }
}

module.exports = { saveBookingToDB }
