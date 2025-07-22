const axios = require('axios');
const fs = require('fs');
const path = require('path');

const tokenPath = path.join(__dirname, 'tokens.json');
const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
const accessToken = tokenData.access_token;

// Replace this with your contact details
const contactPayload = {
  firstName: 'Tarun',
  lastName: 'Kumar',
  email: 'tarunkumr@example.com',
  phone: '+9199999999889',
  locationId: '7LYI93XFo8j4nZfswlaz' 
};

axios.post(
  'https://services.leadconnectorhq.com/contacts/',
  contactPayload,
  {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: '2021-04-15',
      'Content-Type': 'application/json'
    }
  }
)
.then((res) => {
  console.log('✅ Contact created:', res.data);
  console.log('🆔 Contact ID:', res.data.id); // 💥 Use this in bookSlot.js
})
.catch((err) => {
  console.error('❌ Contact creation failed:', err.response?.data || err.message);
});
