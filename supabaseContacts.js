require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function saveContactToDB(contact) {
  try {
    if (!contact || !contact.id) {
      console.error('❌ Invalid contact object passed:', contact);
      return { success: false, error: 'Invalid contact object' };
    }

    const { error } = await supabase
      .from('restyle_customers')
      .insert([{
        id: contact.id,
        date_added: contact.dateAdded || null,
        date_updated: contact.dateUpdated || null,
        tags: contact.tags || [],
        type: contact.type || null,
        location_id: contact.locationId || null,
        first_name: contact.firstName || null,
        last_name: contact.lastName || null,
        last_name_lowercase: contact.lastNameLowerCase || null,
        email: contact.email || null,
        bounce_email: contact.bounceEmail ?? null,
        unsubscribe_email: contact.unsubscribeEmail ?? null,
        phone: contact.phone || null,
        country: contact.country || null,
        source: contact.source || null,

        created_by_source_id: contact.createdBy?.sourceId || null,
        created_by_timestamp: contact.createdBy?.timestamp || null,
        last_updated_by_source_id: contact.lastUpdatedBy?.sourceId || null,
        last_updated_by_timestamp: contact.lastUpdatedBy?.timestamp || null,

        last_session_activity_at: contact.lastSessionActivityAt || null,
        valid_email: contact.validEmail ?? null,
        valid_email_date: contact.validEmailDate || null
      }]);

    if (error) {
      console.error('❌ Supabase insert error:', error.message);
      return { success: false, error: error.message };
    }

    console.log(`✅ Contact ${contact.id} saved to restyle_customers`);
    return { success: true };
  } catch (err) {
    console.error('❌ Unexpected Supabase error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { saveContactToDB };
