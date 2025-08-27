// netlify/functions/bookings.js
const { createClient } = require("@supabase/supabase-js")
// optional: if you later decide to also cancel in LeadConnector, we can use axios + your token helper
// const axios = require("axios")
// const { getValidAccessToken } = require("../../supbase")

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY // use service role for RLS-bypass if needed
const supabase = createClient(supabaseUrl, supabaseKey)

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  }
}

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" }
  }

  try {
    const method = event.httpMethod

    // GET /bookings?contactId=...
    if (method === "GET") {
      const params = event.queryStringParameters || {}
      const contactId = params.contactId

      if (!contactId) {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ error: "Missing contactId" }),
        }
      }

      const { data, error } = await supabase
        .from("restyle_bookings")
        .select("*")
        .eq("contact_id", contactId)
        .order("id", { ascending: false }) // adjust ordering as you prefer

      if (error) {
        console.error("❌ Supabase error (GET):", error)
        return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: error.message }) }
      }

      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ bookings: data }) }
    }

    // DELETE /bookings  with JSON body { id, contactId }
    if (method === "DELETE") {
      let body = {}
      try {
        body = JSON.parse(event.body || "{}")
      } catch (e) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid JSON" }) }
      }

      const { id, contactId } = body
      if (!id || !contactId) {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ error: "Missing required fields: id, contactId" }),
        }
      }

      // Safety check: ensure the booking belongs to this contact
      const { data: found, error: findErr } = await supabase
        .from("restyle_bookings")
        .select("id, contact_id")
        .eq("id", id)
        .single()

      if (findErr || !found) {
        return {
          statusCode: 404,
          headers: corsHeaders(),
          body: JSON.stringify({ error: "Booking not found" }),
        }
      }

      if (found.contact_id !== contactId) {
        return {
          statusCode: 403,
          headers: corsHeaders(),
          body: JSON.stringify({ error: "Forbidden: booking does not belong to this contact" }),
        }
      }

      // If you also want to cancel at LeadConnector, do it here first (uncomment + adapt):
      /*
      const token = await getValidAccessToken()
      await axios.delete(`https://services.leadconnectorhq.com/calendars/events/appointments/${id}`, {
        headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15" }
      })
      */

      const { error: delErr } = await supabase.from("restyle_bookings").delete().eq("id", id)
      if (delErr) {
        console.error("❌ Supabase delete error:", delErr)
        return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: delErr.message }) }
      }

      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true }) }
    }

    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method Not Allowed" }) }
  } catch (err) {
    console.error("❌ bookings.js failed:", err)
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) }
  }
}
