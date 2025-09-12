// Simple test for parsing logic

// Parse weekend_days robustly
function parseWeekendDays(val) {
  if (!val) return []
  if (Array.isArray(val)) return val.map(normalizeDayName)
  if (typeof val === "string") {
    try {
      // Handle JSON string format like "{\"Sunday\"}" or "{\"Saturday\",\"Sunday\"}"
      const parsed = JSON.parse(val)
      if (Array.isArray(parsed)) return parsed.map(normalizeDayName)
      // Handle object format like {"Sunday": true} or just "Sunday"
      if (typeof parsed === "object" && parsed !== null) {
        return Object.keys(parsed).map(normalizeDayName)
      }
      if (typeof parsed === "string") {
        return [normalizeDayName(parsed)]
      }
    } catch (e) {
      // Handle malformed JSON - try to extract day names
      console.log(`[v0] Parsing weekend_days manually: ${val}`)
      // Remove brackets, quotes, backslashes and split by common separators
      const cleaned = val.replace(/[{}[\]"\\]/g, "").trim()
      const parts = cleaned
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (parts.length > 0) {
        console.log(`[v0] Extracted weekend days: ${parts}`)
        return parts.map(normalizeDayName)
      }
    }
  }
  return []
}

function normalizeDayName(d) {
  if (!d) return d
  const s = String(d).trim()
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

// Test weekend days parsing
console.log('Testing weekend days parsing:');
const testWeekendDays = '"{\\"Sunday\\"}"';
const parsed = parseWeekendDays(testWeekendDays);
console.log('Input:', testWeekendDays);
console.log('Parsed:', parsed);

// Test date parsing
console.log('\nTesting date parsing:');
const testDate = '9/17/2025, 12:00:00 AM';
const [datePart] = testDate.split(',');
const parsedDate = new Date(datePart.trim());
const dateKey = parsedDate.toLocaleDateString("sv-SE", { timeZone: "America/Denver" });
console.log('Input:', testDate);
console.log('Parsed date:', parsedDate);
console.log('Date key:', dateKey);

// Test time block date parsing
console.log('\nTesting time block date parsing:');
const testBlockDate = '7/26/2025, 12:00:00 AM';
const [blockDatePart] = testBlockDate.split(',');
const parsedBlockDate = new Date(blockDatePart.trim());
const blockDateKey = parsedBlockDate.toLocaleDateString("sv-SE", { timeZone: "America/Denver" });
console.log('Input:', testBlockDate);
console.log('Parsed date:', parsedBlockDate);
console.log('Date key:', blockDateKey);
