// Zero-dependency HTTP server with two webhook endpoints:
//   POST /webhooks/portal-rsvp  member portal -> HubSpot (signed with a shared secret)
//   POST /webhooks/hubspot      HubSpot -> this service (HubSpot signature v3)
//   GET  /health

const http = require('node:http');
const { createClient } = require('./hubspot');
const { syncRsvp } = require('./sync');
const { verifyPortalSignature, verifyHubSpotV3 } = require('./signatures');

const MAX_BODY_BYTES = 100 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function createServer({ client, portalSecret, hubspotClientSecret, publicBaseUrl, logger = console }) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });

      if (req.method === 'POST' && req.url === '/webhooks/portal-rsvp') {
        const raw = await readBody(req);
        if (!verifyPortalSignature(raw, req.headers['x-portal-signature'], portalSecret)) {
          return send(res, 401, { error: 'invalid signature' });
        }
        let payload;
        try {
          payload = JSON.parse(raw);
        } catch {
          return send(res, 400, { error: 'invalid JSON' });
        }
        const result = await syncRsvp(client, payload, logger);
        return send(res, result.ok ? 200 : 422, result);
      }

      if (req.method === 'POST' && req.url === '/webhooks/hubspot') {
        const raw = await readBody(req);
        const valid = verifyHubSpotV3({
          method: 'POST',
          uri: `${publicBaseUrl}${req.url}`,
          rawBody: raw,
          timestamp: req.headers['x-hubspot-request-timestamp'],
          signature: req.headers['x-hubspot-signature-v3'],
          secret: hubspotClientSecret,
        });
        if (!valid) return send(res, 401, { error: 'invalid signature' });
        const events = JSON.parse(raw);
        for (const e of events) {
          logger.info(`HubSpot event: ${e.subscriptionType} on object ${e.objectId}`);
        }
        return send(res, 200, { received: events.length });
      }

      return send(res, 404, { error: 'not found' });
    } catch (err) {
      logger.error(err.message);
      return send(res, err.status || 500, { error: err.status ? err.message : 'internal error' });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const client = createClient({ token: process.env.HUBSPOT_TOKEN });
  createServer({
    client,
    portalSecret: process.env.PORTAL_WEBHOOK_SECRET,
    hubspotClientSecret: process.env.HUBSPOT_CLIENT_SECRET,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
  }).listen(port, () => console.log(`Listening on :${port}`));
}

module.exports = { createServer };
