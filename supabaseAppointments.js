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

    // Ensure the referenced contact exists to satisfy FK constraint
    await ensureContactExists(booking.contactId)

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

    // ✅ Upsert to avoid duplicates if the booking already exists
    const { data, error } = await supabase
      .from("restyle_bookings")
      .upsert([mappedBooking], { onConflict: "id" })
      .select()

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

// Ensure contact exists in restyle_contacts to satisfy FK when inserting booking
async function ensureContactExists(contactId) {
  try {
    if (!contactId) return

    const { data: existing, error: selectError } = await supabase
      .from("restyle_contacts")
      .select("id")
      .eq("id", contactId)
      .maybeSingle()

    if (selectError) {
      console.warn("⚠️ Supabase select contact warning:", selectError)
    }

    if (existing?.id) {
      return
    }

    const now = new Date()
    const minimalContactRow = {
      id: contactId,
      date_added: now,
      date_updated: now,
      deleted: false,
      tags: [],
      type: "customer",
      custom_fields: [],
      location_id: null,
      first_name: null,
      first_name_lowercase: null,
      last_name: null,
      last_name_lowercase: null,
      full_name_lowercase: null,
      email: null,
      email_lowercase: null,
      bounce_email: false,
      unsubscribe_email: false,
      phone: null,
      country: "US",
      source: "api",
      created_by_source: "api",
      created_by_channel: "api",
      created_by_source_id: null,
      created_by_timestamp: now,
      last_updated_by_source: "system",
      last_updated_by_channel: "api",
      last_updated_by_source_id: null,
      last_updated_by_timestamp: now,
      last_session_activity_at: now,
      valid_email: true,
      valid_email_date: now,
    }

    const { error: insertError } = await supabase
      .from("restyle_contacts")
      .insert([minimalContactRow])

    if (insertError) {
      // If another request inserted concurrently, ignore unique violation
      // Code 23505 is unique_violation in Postgres
      if (insertError.code !== "23505") {
        throw insertError
      }
    }
  } catch (err) {
    console.error("❌ ensureContactExists failed:", err.message || err)
    // Do not block booking save on ensure failure; rethrow to surface in logs
    throw err
  }
}

module.exports = { saveBookingToDB }
