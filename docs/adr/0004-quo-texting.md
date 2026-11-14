---
status: accepted
---

# Quo is the business phone; the CRM hears it by webhook and texts through it once A2P is approved

The site's number is now the Quo line (484) 939-DECK / 939-3325 (Quo was called OpenPhone). Pat answers calls and texts in the
Quo app. The CRM connects to Quo two ways:

1. **In: webhook.** Settings > Texting > Connect Quo calls Quo's API (`QUO_API_KEY`, version 2026-03-30) to find the
   number and create a webhook to `/api/public/quo-webhook` for `message.received`, `message.delivered`,
   `call.completed` and `call.voicemail.completed`. Quo returns the signing secret once; it is stored in
   `quo_connection` and never shown. Deliveries are verified with Standard Webhooks signatures (5-minute tolerance)
   and deduped by `webhook-id` (`quo_webhook_events`, swept after 3 days) and by Quo's message or call id on the
   activity row. Webhooks made in the Quo app use an older signature scheme and are not supported.
   - Texts and voicemails from unknown numbers become new Leads (source `text` / `phone`). Calls do only when an
     incoming answered call lasted 30 seconds or more, so robocalls and wrong numbers stay out of the Pipeline.
   - Pat's outgoing texts and answered calls move a new Lead to contacted, as when Staff log contact.
   - STOP-type words revoke text consent (`consent_events`, source `text`); START grants it again. A first text from
     a number with no consent history counts as consent to reply about their project.
2. **Out: texts.** Two outbox kinds sent by Quo instead of Resend: `sms_lead_reply` (the instant reply to a new
   website Lead who ticked "Text me about my project") and `sms_owner` (a photo link to Pat's cell). Sending needs
   Quo connected, `QUO_API_KEY`, and the `texting_enabled` switch, which an admin turns on in Settings > Texting only
   after Quo shows carrier registration (A2P 10DLC) approved. Homeowner texts also need a current consent grant and
   no Do not contact flag; both are checked at send time.

## Consequences

- Quo's send has no idempotency key, so a text that may have reached Quo (timeout, 5xx, a lease that expired mid-send)
  is never sent again: the job goes dead and the Lead shows "Automatic text not sent". Only a 429 is retried.
- The site's forms send `sms_consent` and the wording version (`src/lib/sms-consent.ts`) only when the box is ticked.
  The privacy policy has the texting section carriers look for. Change both together and bump the version.
- Quo's own missed-call auto-reply and business-hours greetings are set in the Quo app, not here.
- Not built: two-way texting inside the CRM (Pat texts from the Quo app; it shows on the Lead), automatic follow-up
  sequences, logging texts on Customers who have no Lead.
