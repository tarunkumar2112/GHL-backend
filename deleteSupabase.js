// deleteSupabase.js
const { createClient } = require("@supabase/supabase-js")

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * Delete booking from Supabase by ID
 * @param {string} bookingId
 */
async function deleteBookingFromDB(bookingId) {
  try {
    console.log("🗑️ Attempting to delete booking:", bookingId)

    const { data, error } = await supabase
      .from("restyle_bookings")
      .delete()
      .eq("id", bookingId)

    if (error) {
      console.error("❌ Supabase delete error:", error)
      throw new Error(`Supabase delete error: ${error.message} (Code: ${error.code})`)
    }

    console.log("✅ Successfully deleted booking:", data)
    return data
  } catch (err) {
    console.error("❌ Error deleting booking from DB:", err.message)
    throw err
  }
}

module.exports = { deleteBookingFromDB }
