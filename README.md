
# 🚀 LeadConnector Token Manager – Node.js Backend Scripts

This repository contains Node.js scripts to interact with the LeadConnector (GHL) API. You can fetch staff, calendar groups, slots, and create appointments — all with refreshable token authentication.

---

## 📁 File Overview

| File Name             | Purpose                                                                 |
|-----------------------|-------------------------------------------------------------------------|
| `token.js`            | Refreshes access token from the refresh token, saves to `tokens.json`  |
| `tokens.json`         | Stores current `access_token` and `refresh_token`                       |
| `user.js`             | Fetches all users/staff (used for `assignedUserId`)                     |
| `group.js`            | Fetches calendar groups by `locationId`                                 |
| `getSlot.js`         | Fetches available slots for a calendar                                  |
| `getStaffSlots.js`    | Fetches available slots for a specific staff calendar                   |
| `bookSlot.js`         | Books a time slot (creates an appointment)                              |
| `createContact.js`    | Creates a new contact in LeadConnector                                  |
| `gents.js` / `ladies.js` | Custom API routes (based on calendar filters or categories)         |
| `package.json`        | Standard npm setup file with dependencies                               |

---

## 🧪 How to Run Scripts from Terminal

> ⚠️ Make sure you’ve installed dependencies first:

```bash
npm install
```

### 1. 🔐 Get Access Token
```bash
node token.js
```

### 2. 👥 Fetch Users/Staff
```bash
node user.js
```

### 3. 📆 Fetch Calendar Groups
```bash
node group.js
```

### 4. 📅 Get Available Slots

#### General calendar slots (non-staff-specific):
```bash
node getslot.js
```

#### Specific staff calendar slots:
```bash
node getStaffSlots.js
```

### 5. 👤 Create Contact
```bash
node createContact.js
```

### 6. ✅ Book an Appointment
```bash
node bookSlot.js
```

---

## 🌍 Where to See Appointments in GHL

| Section             | Path                                |
|---------------------|--------------------------------------|
| 📅 Calendar View     | Calendars > Calendar View            |
| 📋 Appointment List  | Calendars > Appointments             |
| 👤 Contact Timeline   | Contacts > [Click Contact] > Timeline|

---

## 💻 Frontend Integration Example (Fetch)

```js
fetch('/api/book-slot', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    contactId: 'u1FDoBrP02t9LP4X2Qf2',
    calendarId: 'woILyX2cMn3skq1MaTgL',
    locationId: '7LYI93XFo8j4nZfswlaz',
    startTime: '2025-07-23T12:30:00-07:00'
  })
})
.then(res => res.json())
.then(data => console.log('✅ Booked:', data))
.catch(err => console.error('❌ Error:', err));
```

---

## 📦 Optional `.env` Setup

```env
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
REFRESH_TOKEN=your_refresh_token
```

---

## ✨ Author

Built by **Tarun Kumar** – Full Stack Dev 🧠  
Expert in: Node.js, Next.js, GHL APIs, Automation, and Custom Booking Flows.

---

**Let’s automate those bookings! 🔥**
