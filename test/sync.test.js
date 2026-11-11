const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../src/hubspot');
const { syncRsvp, validateRsvp, maskEmail } = require('../src/sync');
const { createServer } = require('../src/server');
const { signPortalPayload, signHubSpotV3, verifyHubSpotV3 } = require('../src/signatures');

const silent = { info() {}, error() {} };

// Fake fetch that records calls and returns canned HubSpot responses.
function fakeFetch(responses = []) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const r = responses.shift() || { status: 200, body: {} };
    return {
      ok: r.status < 400,
      status: r.status,
      headers: { get: () => null },
      text: async () => JSON.stringify(r.body),
    };
  };
  fn.calls = calls;
  return fn;
}

const validRsvp = {
  email: 'Jane.Doe@Example.com',
  firstname: 'Jane',
  event_name: 'Spring Chapter Meeting',
  event_date: '2027-03-12',
  rsvp_status: 'attending',
};

test('validateRsvp catches bad input', () => {
  const errors = validateRsvp({ email: 'nope', event_date: '03/12/2027', rsvp_status: 'maybe' });
  assert.equal(errors.length, 4);
  assert.deepEqual(validateRsvp(validRsvp), []);
});

test('syncRsvp upserts the contact by email, then logs a note', async () => {
  const fetchImpl = fakeFetch([
    { status: 200, body: { results: [{ id: '501' }] } },
    { status: 201, body: { id: '9001' } },
  ]);
  const client = createClient({ token: 't', fetchImpl });
  const result = await syncRsvp(client, validRsvp, silent);

  assert.deepEqual(result, { ok: true, contactId: '501' });
  const [upsert, note] = fetchImpl.calls;
  assert.match(upsert.url, /\/crm\/v3\/objects\/contacts\/batch\/upsert$/);
  assert.equal(upsert.headers.Authorization, 'Bearer t');
  assert.deepEqual(upsert.body.inputs[0], {
    idProperty: 'email',
    id: 'jane.doe@example.com',
    properties: {
      email: 'jane.doe@example.com',
      firstname: 'Jane',
      portal_last_event_name: 'Spring Chapter Meeting',
      portal_last_event_date: '2027-03-12',
      portal_rsvp_status: 'attending',
    },
  });
  assert.match(note.url, /\/crm\/v3\/objects\/notes$/);
  assert.equal(note.body.associations[0].to.id, '501');
  assert.equal(note.body.associations[0].types[0].associationTypeId, 202);
});

test('client retries on 429 then succeeds', async () => {
  const fetchImpl = fakeFetch([{ status: 429, body: {} }, { status: 200, body: { results: [{ id: '7' }] } }]);
  const client = createClient({ token: 't', fetchImpl, baseDelayMs: 1 });
  const contact = await client.upsertContactByEmail('a@b.co', {});
  assert.equal(contact.id, '7');
  assert.equal(fetchImpl.calls.length, 2);
});

test('client surfaces HubSpot errors with status', async () => {
  const fetchImpl = fakeFetch([{ status: 400, body: { message: 'bad property' } }]);
  const client = createClient({ token: 't', fetchImpl });
  await assert.rejects(client.upsertContactByEmail('a@b.co', {}), (err) => err.status === 400);
});

test('maskEmail keeps member emails out of logs', () => {
  assert.equal(maskEmail('jane.doe@example.com'), 'j***@example.com');
});

test('HubSpot v3 signatures verify and reject stale or tampered requests', () => {
  const args = { method: 'POST', uri: 'https://x.io/webhooks/hubspot', rawBody: '[]', secret: 's' };
  const now = Date.now();
  const signature = signHubSpotV3({ ...args, timestamp: String(now) });
  assert.equal(verifyHubSpotV3({ ...args, timestamp: String(now), signature, now }), true);
  assert.equal(verifyHubSpotV3({ ...args, rawBody: '[1]', timestamp: String(now), signature, now }), false);
  assert.equal(verifyHubSpotV3({ ...args, timestamp: String(now - 6 * 60 * 1000), signature, now }), false);
});

test('server rejects unsigned portal webhooks and accepts signed ones', async () => {
  const fetchImpl = fakeFetch([
    { status: 200, body: { results: [{ id: '501' }] } },
    { status: 201, body: { id: '9001' } },
  ]);
  const server = createServer({
    client: createClient({ token: 't', fetchImpl }),
    portalSecret: 'shh',
    hubspotClientSecret: 'hs',
    publicBaseUrl: 'http://localhost',
    logger: silent,
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/webhooks/portal-rsvp`;
  const body = JSON.stringify(validRsvp);

  try {
    const unsigned = await fetch(url, { method: 'POST', body });
    assert.equal(unsigned.status, 401);

    const signed = await fetch(url, {
      method: 'POST',
      body,
      headers: { 'X-Portal-Signature': signPortalPayload(body, 'shh') },
    });
    assert.equal(signed.status, 200);
    assert.deepEqual(await signed.json(), { ok: true, contactId: '501' });
    assert.equal(fetchImpl.calls.length, 2, 'unsigned request never reached HubSpot');
  } finally {
    server.close();
  }
});
