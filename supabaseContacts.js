// supabaseContacts.js
const { createClient } = require("@supabase/supabase-js")

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * Save or update a contact in Supabase
 * @param {Object} contact
 */
async function saveContactToDB(contact) {
  try {
    console.log("📝 Attempting to save contact:", JSON.stringify(contact, null, 2))

    const mappedContact = {
      id: contact.id,
      date_added: contact.dateAdded ? new Date(contact.dateAdded) : new Date(),
      date_updated: contact.dateUpdated ? new Date(contact.dateUpdated) : new Date(),
      deleted: contact.deleted || false,
      tags: contact.tags || [],
      type: contact.type || "customer",

      custom_fields: contact.customFields || [],

      location_id: contact.locationId || null,

      first_name: contact.firstName || null,
      first_name_lowercase: contact.firstName?.toLowerCase() || null,
      last_name: contact.lastName || null,
      last_name_lowercase: contact.lastName?.toLowerCase() || null,
      full_name_lowercase:
        contact.firstName && contact.lastName ? `${contact.firstName} ${contact.lastName}`.toLowerCase() : null,

      email: contact.email || null,
      email_lowercase: contact.email?.toLowerCase() || null,
      bounce_email: contact.bounceEmail || false,
      unsubscribe_email: contact.unsubscribeEmail || false,

      phone: contact.phone || null,
      country: contact.country || "US",
      source: contact.source || "api",

      created_by_source: contact.createdBy?.source || "api",
      created_by_channel: contact.createdBy?.channel || "form",
      created_by_source_id: contact.createdBy?.sourceId || null,
      created_by_timestamp: contact.createdBy?.timestamp ? new Date(contact.createdBy.timestamp) : new Date(),

      last_updated_by_source: contact.lastUpdatedBy?.source || "system",
      last_updated_by_channel: contact.lastUpdatedBy?.channel || "api",
      last_updated_by_source_id: contact.lastUpdatedBy?.sourceId || null,
      last_updated_by_timestamp: contact.lastUpdatedBy?.timestamp
        ? new Date(contact.lastUpdatedBy.timestamp)
        : new Date(),

      last_session_activity_at: contact.lastSessionActivityAt ? new Date(contact.lastSessionActivityAt) : new Date(),
      valid_email: contact.validEmail !== undefined ? contact.validEmail : true,
      valid_email_date: contact.validEmailDate ? new Date(contact.validEmailDate) : new Date(),
    }

    console.log("🗂️ Mapped contact for DB:", JSON.stringify(mappedContact, null, 2))

    const { data, error } = await supabase.from("restyle_contacts").insert(mappedContact).select()

    if (error) {
      console.error("❌ Supabase error details:", error)
      throw new Error(`Supabase error: ${error.message} (Code: ${error.code})`)
    }

    console.log("✅ Successfully saved contact to DB:", data)
    return data
  } catch (err) {
    console.error("❌ Error saving contact to DB:", err.message)
    console.error("❌ Full error:", err)
    throw err
  }
}

module.exports = { saveContactToDB }
