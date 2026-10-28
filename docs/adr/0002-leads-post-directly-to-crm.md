---
status: accepted
---

# Leads post directly to the CRM; Web3Forms is removed

Both the quote form and the estimator used to email leads through Web3Forms from the browser, with a public access key.
They will instead post to the CRM's public intake, which stores the lead before sending any notification. Web3Forms is
removed rather than kept as a fallback: receiving its submissions server-side needs a paid plan, and two lead paths
would split leads between the inbox and the CRM. This is the same move Pine & Gable made (its ADR 0003).

## Consequences

- The CLAUDE.md rules about `SITE.web3formsKey` and `submitLead` posting to Web3Forms are retired once the cutover
  ships.
- The CRM emails the owner about every new Lead through Resend, using the ported email outbox with retries, as Good
  Cover and Pine & Gable do. Email is a notification of a stored Lead, never a second place leads live.
- There is no backup path. If the CRM intake is unreachable after the client's automatic retries, the site shows a
  clear error with tap-to-call and keeps the visitor's answers so they can try again. Good Cover's backup Pages
  Function was considered and rejected: it could not show a price, and leads sent through it would exist only in the
  inbox.
