// Simulates the member portal: sends a signed RSVP to the running server.
// Usage: PORTAL_WEBHOOK_SECRET=... node scripts/send-test-rsvp.js you@example.com

const { signPortalPayload } = require('../src/signatures');

const url = process.env.SYNC_URL || 'http://localhost:3000/webhooks/portal-rsvp';
const body = JSON.stringify({
  email: process.argv[2] || 'test.member@example.com',
  firstname: 'Test',
  lastname: 'Member',
  event_name: 'Spring Chapter Meeting',
  event_date: '2027-03-12',
  rsvp_status: 'attending',
});

fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Portal-Signature': signPortalPayload(body, process.env.PORTAL_WEBHOOK_SECRET),
  },
  body,
})
  .then(async (res) => console.log(res.status, await res.text()))
  .catch((err) => console.error(err.message));
