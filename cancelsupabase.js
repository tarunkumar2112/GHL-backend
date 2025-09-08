const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Cancel a booking in Supabase
 * @param {Object} booking
 */
async function cancelBookingInDB(booking) {
  try {
    console.log("✂️ Attempting to cancel booking:", JSON.stringify(booking, null, 2));

    const mappedBooking = {
      calendar_id: booking.calendarId || null,
      contact_id: booking.contactId || null,
      title: booking.title || null,
      status: "cancelled",
      appointment_status: "cancelled",
      assigned_user_id: booking.assignedUserId || null,
      address: booking.address || null,
      is_recurring: booking.isRecurring || false,
      trace_id: booking.traceId || null,
    };

    console.log("🗂️ Mapped booking for DB cancel:", JSON.stringify(mappedBooking, null, 2));

    // 🔄 Update existing booking by ID
    const { data, error } = await supabase
      .from("restyle_bookings")
      .update(mappedBooking)
      .eq("id", booking.id)
      .select();

    if (error) {
      console.error("❌ Supabase cancel error:", error);
      throw new Error(`Supabase error: ${error.message} (Code: ${error.code})`);
    }

    console.log("✅ Successfully cancelled booking in DB:", data);
    return data;
  } catch (err) {
    console.error("❌ Error cancelling booking in DB:", err.message);
    throw err;
  }
}

module.exports = { cancelBookingInDB };
