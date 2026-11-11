// One-time setup: creates the "Member Portal" property group and the custom
// contact properties the sync writes to. Safe to re-run (409 = already exists).
// Usage: HUBSPOT_TOKEN=... node scripts/setup-properties.js

const { createClient } = require('../src/hubspot');
const { RSVP_STATUSES } = require('../src/sync');

const GROUP = { name: 'member_portal', label: 'Member Portal' };

const PROPERTIES = [
  { name: 'portal_last_event_name', label: 'Last Event RSVP', type: 'string', fieldType: 'text' },
  { name: 'portal_last_event_date', label: 'Last Event Date', type: 'date', fieldType: 'date' },
  {
    name: 'portal_rsvp_status',
    label: 'Portal RSVP Status',
    type: 'enumeration',
    fieldType: 'select',
    options: RSVP_STATUSES.map((s, i) => ({ label: s[0].toUpperCase() + s.slice(1), value: s, displayOrder: i })),
  },
];

async function ignoreExisting(promise, label) {
  try {
    await promise;
    console.log(`Created ${label}`);
  } catch (err) {
    if (err.status === 409) console.log(`${label} already exists`);
    else throw err;
  }
}

async function main() {
  const client = createClient({ token: process.env.HUBSPOT_TOKEN });
  await ignoreExisting(client.createPropertyGroup('contacts', GROUP), `group ${GROUP.name}`);
  for (const p of PROPERTIES) {
    await ignoreExisting(client.createProperty('contacts', { ...p, groupName: GROUP.name }), `property ${p.name}`);
  }
}

main().catch((err) => {
  console.error(err.message, err.body || '');
  process.exit(1);
});
