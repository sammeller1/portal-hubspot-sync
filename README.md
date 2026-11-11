# portal-hubspot-sync

A small service that connects a membership organization's member portal to HubSpot. When a member RSVPs to an event in the portal, the service updates their HubSpot contact and logs the RSVP on their timeline. A HubSpot workflow then handles the follow-up, such as a confirmation email or a task for the events team.

It's built for an organization with one technical owner: no framework, no dependencies, and small enough to read in one sitting.

## How it works

```
Member portal ──signed webhook──▶ /webhooks/portal-rsvp ──▶ HubSpot CRM v3
                                                              │ contact upsert (by email)
                                                              │ timeline note
                                                              ▼
                                                   HubSpot workflow (triggered by
                                                   "Portal RSVP Status" changing)

HubSpot ──v3 signed webhook──▶ /webhooks/hubspot   (contact change events, for the reverse direction)
```

1. **The portal sends an RSVP** signed with HMAC-SHA256 and a shared secret. Unsigned or tampered requests are rejected before anything reaches HubSpot.
2. **The service upserts the contact** through `POST /crm/v3/objects/contacts/batch/upsert`, matched on email, so there are no duplicate contacts.
3. **It adds a note** to the contact timeline with `POST /crm/v3/objects/notes` and a note-to-contact association.
4. **A HubSpot workflow** enrolls on the `portal_rsvp_status` property and does the follow-up. Logic that the marketing team should own stays in HubSpot, where they can see and change it.

## Design choices

- **Security:** signed webhooks in both directions. HubSpot's v3 signature check rejects requests older than 5 minutes to stop replays, and comparisons are timing-safe. Request bodies are capped at 100 KB.
- **Data handling:** only the fields the workflow needs leave the portal, and logs mask member emails.
- **Reliability:** retries with backoff on rate limits (429) and server errors, honoring `Retry-After`.
- **Clean ownership:** custom properties live in their own "Member Portal" group, so integration fields stay apart from the CRM data and reporting other teams own.

## Setup

1. In HubSpot, create a private app (Settings > Integrations > Private Apps) with these scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.write`.
2. Copy `.env.example` to `.env`, then fill in `HUBSPOT_TOKEN` and `PORTAL_WEBHOOK_SECRET`.
3. Create the custom properties:
   ```bash
   export $(cat .env | xargs)
   npm run setup
   ```
4. Start the service, and send a test RSVP from a second terminal:
   ```bash
   npm start
   npm run send-test -- you@example.com
   ```
5. In HubSpot, open the contact. The Member Portal properties are set, and the RSVP note is on the timeline.
6. Optional: create a contact-based workflow with the enrollment trigger "Portal RSVP Status is any of Attending" to send a confirmation email.

## Tests

```bash
npm test
```

The tests use a fake HubSpot API, so they run without an account. They cover input validation, the upsert and note calls, retry on 429, error handling, email masking, and signature checks.

## Where this would go next

- A queue (for example, SQS or a HubSpot custom object) if RSVP volume grows or HubSpot is down for longer than the retries cover
- Custom objects for events, so one contact can hold many RSVPs
- Monitoring and alerting on failed syncs
