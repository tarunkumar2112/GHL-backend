// Test script for slots filtering logic
const { parseWeekendDays, normalizeDayName } = require('./netlify/functions/slots.js');

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
