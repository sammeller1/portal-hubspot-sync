// Business logic: turn a member-portal event RSVP into HubSpot CRM updates.
// Setting these contact properties is what triggers HubSpot workflows
// (for example, a confirmation email or a task for the events team).

const RSVP_STATUSES = ['attending', 'declined', 'waitlist'];

function validateRsvp(payload) {
  const errors = [];
  const p = payload || {};
  if (typeof p.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) errors.push('email is invalid');
  if (!p.event_name) errors.push('event_name is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.event_date || '')) errors.push('event_date must be YYYY-MM-DD');
  if (!RSVP_STATUSES.includes(p.rsvp_status)) errors.push(`rsvp_status must be one of ${RSVP_STATUSES.join(', ')}`);
  return errors;
}

// Data minimization: only these fields ever leave the portal.
function toContactProperties(p) {
  const props = {
    portal_last_event_name: p.event_name,
    portal_last_event_date: p.event_date,
    portal_rsvp_status: p.rsvp_status,
  };
  if (p.firstname) props.firstname = p.firstname;
  if (p.lastname) props.lastname = p.lastname;
  return props;
}

// Logs show a masked email so member data stays out of log files.
function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}

async function syncRsvp(client, payload, logger = console) {
  const errors = validateRsvp(payload);
  if (errors.length) return { ok: false, errors };

  const contact = await client.upsertContactByEmail(payload.email.toLowerCase(), toContactProperties(payload));
  await client.addNoteToContact(
    contact.id,
    `Member portal RSVP: ${payload.rsvp_status} for ${payload.event_name} (${payload.event_date})`
  );
  logger.info(`Synced RSVP for ${maskEmail(payload.email)} to contact ${contact.id}`);
  return { ok: true, contactId: contact.id };
}

module.exports = { syncRsvp, validateRsvp, toContactProperties, maskEmail, RSVP_STATUSES };
