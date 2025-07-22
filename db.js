// db.js
const { Pool } = require('pg');
require('dotenv').config(); // Loads .env variables

const pool = new Pool({
  connectionString: process.env.NEON_DB_URL,
  ssl: {
    rejectUnauthorized: false // Required for Neon
  }
});

module.exports = pool;
