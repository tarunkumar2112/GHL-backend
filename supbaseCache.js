const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 📝 Save cache
async function setCache(key, data, ttlMinutes = 5) {
  await supabase.from('slots_cache').upsert({
    cache_key: key,
    data,
    updated_at: new Date().toISOString()
  });
}

// 🔍 Get cache
async function getCache(key, ttlMinutes = 5) {
  const { data, error } = await supabase
    .from('slots_cache')
    .select('*')
    .eq('cache_key', key)
    .single();

  if (error || !data) return null;

  const updatedAt = new Date(data.updated_at).getTime();
  const now = Date.now();

  if (now - updatedAt > ttlMinutes * 60 * 1000) {
    return null; // expired
  }

  return data.data;
}

module.exports = { getCache, setCache };
