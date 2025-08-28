const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Update a booking in Supabase
 * @param {Object} booking
 */
async function updateBookingInDB(booking) {
  try {
    console.log("✏️ Attempting to update booking:", JSON.stringify(booking, null, 2));

    const mappedBooking = {
      calendar_id: booking.calendarId || null,
      contact_id: booking.contactId || null,
      title: booking.title || null,
      status: booking.status || null,
      appointment_status: booking.appoinmentStatus || booking.appointmentStatus || null,
      assigned_user_id: booking.assignedUserId || null,
      address: booking.address || null,
      is_recurring: booking.isRecurring || false,
      trace_id: booking.traceId || null,
    };

    console.log("🗂️ Mapped booking for DB update:", JSON.stringify(mappedBooking, null, 2));

    // 🔄 Update existing booking by ID
    const { data, error } = await supabase
      .from("restyle_bookings")
      .update(mappedBooking)
      .eq("id", booking.id)
      .select();

    if (error) {
      console.error("❌ Supabase update error:", error);
      throw new Error(`Supabase error: ${error.message} (Code: ${error.code})`);
    }

    console.log("✅ Successfully updated booking in DB:", data);
    return data;
  } catch (err) {
    console.error("❌ Error updating booking in DB:", err.message);
    throw err;
  }
}

module.exports = { updateBookingInDB };
