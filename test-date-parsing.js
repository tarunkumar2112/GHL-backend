// Test date parsing logic

// Test time-off date parsing
console.log('Testing time-off date parsing:');
const testStartDate = '9/17/2025, 12:00:00 AM';
const testEndDate = '9/18/2025, 12:00:00 AM';

console.log('Start date:', testStartDate);
console.log('End date:', testEndDate);

// Parse dates
const [startDatePart] = testStartDate.split(',');
const [endDatePart] = testEndDate.split(',');

console.log('Start date part:', startDatePart);
console.log('End date part:', endDatePart);

const startDate = new Date(startDatePart.trim());
const endDate = new Date(endDatePart.trim());

console.log('Parsed start date:', startDate);
console.log('Parsed end date:', endDate);

// Get date keys
const startDateKey = startDate.toLocaleDateString("sv-SE", { timeZone: "America/Denver" });
const endDateKey = endDate.toLocaleDateString("sv-SE", { timeZone: "America/Denver" });

console.log('Start date key:', startDateKey);
console.log('End date key:', endDateKey);

// Test slot date
const slotDate = '2025-09-18';
console.log('Slot date:', slotDate);

// Check if blocked
const isDateBlocked = slotDate >= startDateKey && slotDate <= endDateKey;
console.log('Is date blocked:', isDateBlocked);

// Test time-block date parsing
console.log('\nTesting time-block date parsing:');
const testBlockDate = '7/26/2025, 12:00:00 AM';
console.log('Block date:', testBlockDate);

const [blockDatePart] = testBlockDate.split(',');
console.log('Block date part:', blockDatePart);

const blockDate = new Date(blockDatePart.trim());
console.log('Parsed block date:', blockDate);

const blockDateKey = blockDate.toLocaleDateString("sv-SE", { timeZone: "America/Denver" });
console.log('Block date key:', blockDateKey);
