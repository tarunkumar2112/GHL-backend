// dbSupabase.js
const { Pool } = require("pg");

const supabasePool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
});

module.exports = supabasePool;
