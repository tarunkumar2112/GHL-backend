// netlify/functions/groups.js

const { createClient } = require('@supabase/supabase-js');

// 🔹 Env variables (.env me rakho)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async function (event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  // ✅ Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    const { groupId } = event.queryStringParameters || {};

    let query = supabase.from('groups').select('*');

    // agar groupId diya hai to ek specific record fetch karo
    if (groupId) {
      query = query.eq('id', groupId).single();
    }

    const { data, error } = await query;

    if (error) throw error;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        count: Array.isArray(data) ? data.length : (data ? 1 : 0),
        groups: data
      })
    };

  } catch (err) {
    console.error('❌ Supabase groups fetch error:', err.message);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to fetch groups',
        details: err.message
      })
    };
  }
};
