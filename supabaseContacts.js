require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function saveContactToDB(contact) {
  try {
    const { error } = await supabase
      .from('Restyle_customers')
      .insert([{
        id: contact.id,
        date_added: contact.dateAdded,
        date_updated: contact.dateUpdated,
        tags: contact.tags || [],
        type: contact.type,
        location_id: contact.locationId,
        first_name: contact.firstName,
        last_name: contact.lastName,
        last_name_lowercase: contact.lastNameLowerCase,
        email: contact.email,
        bounce_email: contact.bounceEmail,
        unsubscribe_email: contact.unsubscribeEmail,
        phone: contact.phone,
        country: contact.country,
        source: contact.source,
        created_by_source_id: contact.createdBy?.sourceId || null,
        created_by_timestamp: contact.createdBy?.timestamp || null,
        last_updated_by_source_id: contact.lastUpdatedBy?.sourceId || null,
        last_updated_by_timestamp: contact.lastUpdatedBy?.timestamp || null,
        last_session_activity_at: contact.lastSessionActivityAt,
        valid_email: contact.validEmail,
        valid_email_date: contact.validEmailDate
      }]);

    if (error) {
      console.error('❌ Supabase insert error:', error.message);
      return { success: false, error: error.message };
    }

    console.log(`✅ Contact ${contact.id} saved to Restyle_customers`);
    return { success: true };
  } catch (err) {
    console.error('❌ Unexpected Supabase error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { saveContactToDB };
