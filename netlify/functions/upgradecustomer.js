const axios = require("axios");
const { getValidAccessToken } = require("../../supbase"); // auto-refresh helper

exports.handler = async (event) => {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return {
        statusCode: 401,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Access token missing" }),
      };
    }

    const params = event.queryStringParameters || {};
    const { id, firstName, lastName } = params;

    if (!id) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error: "Missing required query param: id",
        }),
      };
    }

    if (!firstName && !lastName) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error: "At least one field to update is required (firstName, lastName)",
        }),
      };
    }

    // build request body with only provided fields
    const body = {};
    if (firstName) body.firstName = firstName;
    if (lastName) body.lastName = lastName;

    // API call
    const response = await axios.put(
      `https://services.leadconnectorhq.com/contacts/${id}`,
      body,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
      }
    );

    // 🔄 Sync to Supabase minimal contact row so names are reflected
    try {
      const { createClient } = require("@supabase/supabase-js");
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const now = new Date();
      const contactRow = {
        id,
        first_name: firstName || null,
        first_name_lowercase: firstName ? firstName.toLowerCase() : null,
        last_name: lastName || null,
        last_name_lowercase: lastName ? lastName.toLowerCase() : null,
        full_name_lowercase:
          firstName && lastName ? `${firstName} ${lastName}`.toLowerCase() : null,
        date_updated: now,
      };

      await supabase.from("restyle_contacts").upsert([contactRow], { onConflict: "id" });
    } catch (e) {
      console.warn("⚠️ Supabase sync after upgradecustomer failed:", e.message || e);
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        updatedContact: response.data,
      }),
    };
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;

    console.error("❌ Error updating contact:", message);

    return {
      statusCode: status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Failed to update contact",
        details: message,
      }),
    };
  }
};
