---
status: accepted
---

# A separate CRM app on Cloudflare, ending the "fully static, no backend" rule

Turner's Decks was a fully static Astro site with no backend or database. We are adding a CRM as a separate app
hosted on Cloudflare (Worker + D1), following the Good Cover Roofing / Pine & Gable CRM, rather than adding server
endpoints to the Astro site. The public site stays static; only the CRM has a server and a database. We chose this so
Pat gets a real lead pipeline and editable estimator settings, while reusing a stack already built and tested in the
sibling projects (see `docs/research/good-cover-crm.md`).

We port Good Cover's CRM (`feat/crm-intake`) whole and change as little as possible. It is itself a port of the
Pine & Gable CRM, which runs in production, so its proven parts are reused rather than rebuilt; Turner's-specific
work (estimator settings, deck wording) is added on top.

## Consequences

- The CLAUDE.md rules "There is no backend or database. Keep the site fully static" apply to the public site only,
  not to the CRM. The one exception on the public site is the estimator, which loads the latest Published version's
  questions and options (never prices) from the CRM at run time (ADR 0003).
- Two deploys (site + CRM) with a cross-origin intake between them.
