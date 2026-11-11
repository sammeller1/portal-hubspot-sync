const crypto = require('node:crypto');

function safeEqual(a, b) {
  const bufA = Buffer.from(a || '');
  const bufB = Buffer.from(b || '');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Outbound webhooks from the member portal: HMAC-SHA256 of the raw body,
// hex encoded, sent in the X-Portal-Signature header with a shared secret.
function signPortalPayload(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function verifyPortalSignature(rawBody, signature, secret) {
  if (!secret) return false;
  return safeEqual(signPortalPayload(rawBody, secret), signature);
}

// Inbound webhooks from HubSpot, signature v3:
// base64(HMAC-SHA256(clientSecret, method + fullUri + rawBody + timestamp)).
// Requests older than 5 minutes are rejected to block replay attacks.
const MAX_AGE_MS = 5 * 60 * 1000;

function signHubSpotV3({ method, uri, rawBody, timestamp, secret }) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${method}${uri}${rawBody}${timestamp}`)
    .digest('base64');
}

function verifyHubSpotV3({ method, uri, rawBody, timestamp, signature, secret, now = Date.now() }) {
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(now - Number(timestamp)) > MAX_AGE_MS) return false;
  return safeEqual(signHubSpotV3({ method, uri, rawBody, timestamp, secret }), signature);
}

module.exports = { signPortalPayload, verifyPortalSignature, signHubSpotV3, verifyHubSpotV3 };
