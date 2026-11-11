// Minimal HubSpot CRM v3 client. Zero dependencies (Node 18+ global fetch).
// Auth: private app access token, sent as a Bearer token.

const BASE_URL = 'https://api.hubapi.com';

class HubSpotError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'HubSpotError';
    this.status = status;
    this.body = body;
  }
}

function createClient({ token, fetchImpl = globalThis.fetch, maxRetries = 3, baseDelayMs = 500 } = {}) {
  if (!token) throw new Error('HUBSPOT_TOKEN is required');

  async function request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      // Back off on rate limits and transient server errors.
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        const delay = retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        throw new HubSpotError(`HubSpot ${method} ${path} failed with ${res.status}`, res.status, data);
      }
      return data;
    }
  }

  return {
    request,

    // Create or update a contact, matched on email.
    async upsertContactByEmail(email, properties) {
      const data = await request('POST', '/crm/v3/objects/contacts/batch/upsert', {
        inputs: [{ idProperty: 'email', id: email, properties: { email, ...properties } }],
      });
      return data.results[0];
    },

    // Log a note on the contact timeline.
    async addNoteToContact(contactId, body, timestamp = new Date().toISOString()) {
      return request('POST', '/crm/v3/objects/notes', {
        properties: { hs_timestamp: timestamp, hs_note_body: body },
        associations: [
          {
            to: { id: contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }], // note -> contact
          },
        ],
      });
    },

    async createPropertyGroup(objectType, group) {
      return request('POST', `/crm/v3/properties/${objectType}/groups`, group);
    },

    async createProperty(objectType, property) {
      return request('POST', `/crm/v3/properties/${objectType}`, property);
    },
  };
}

module.exports = { createClient, HubSpotError };
