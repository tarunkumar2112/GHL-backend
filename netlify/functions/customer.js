const axios = require("axios")
const { getValidAccessToken } = require("../../supbase") // auto-refresh helper
const { saveContactToDB } = require("../../supabaseContacts")

exports.handler = async (event) => {
  try {
    const accessToken = await getValidAccessToken()

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Access token missing" }),
      }
    }

    const params = event.queryStringParameters || {}
    const { firstName, lastName, phone, notes } = params
    // ❌ removed email destructure

    // ✅ email no longer required
    if (!firstName || !lastName || !phone) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required query params" }),
      }
    }

    const locationId = "7LYI93XFo8j4nZfswlaz" // 🔒 Hardcoded

    const body = {
      firstName,
      lastName,
      phone,
      locationId,
      source: "public api",
      country: "US",
      tags: notes ? [notes] : [],
    }
    // ❌ removed email field

    const response = await axios.post("https://services.leadconnectorhq.com/contacts/", body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
    })

    // ✅ Handle both cases: nested `contact.contact` or direct `contact`
    let newContact = response.data?.contact?.contact || response.data?.contact || null
    console.log("📞 API Response - Extracted contact:", newContact)

    let dbInsert = null
    try {
      if (!newContact || !newContact.id) {
        throw new Error("Invalid contact data received from API")
      }

      dbInsert = await saveContactToDB(newContact)
      console.log("✅ DB save successful:", dbInsert)
    } catch (dbError) {
      console.error("❌ DB save failed:", dbError.message)
      console.error("❌ Contact data that failed:", JSON.stringify(newContact, null, 2))
      dbInsert = { error: dbError.message }
    }

    return {
      statusCode: 201,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, contact: response.data, dbInsert }),
    }
  } catch (err) {
    const status = err.response?.status || 500
    const message = err.response?.data || err.message

    if (status === 422 && message?.message?.includes("already exists")) {
      return {
        statusCode: 409,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Contact already exists", details: message }),
      }
    }

    console.error("❌ Error creating contact:", message)
    return {
      statusCode: status,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to create contact", details: message }),
    }
  }
}
