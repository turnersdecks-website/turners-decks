---
status: accepted
---

# Every Lead records how it reached us and where they found us

Knowing where Leads come from is the most important marketing question for Turner's Decks. Two separate answers per
Lead:

1. **Channel, "Came in by"** (`leads.channel`): estimator, quote form, text, call, email, added by hand, or website
   when an old website Lead's form is not known. Set when the Lead is made: by intake from the form's `source`, by the
   Quo webhook (`text` / `call`), by hand or import. Migration 0009 backfilled it from each Lead's first Form
   submission, else its Source.
2. **Origin, "Found us via"**: Google search, Google Business Profile, Google Ads, Facebook / Instagram, Facebook ads,
   other search, another website, email, tagged link, direct, unknown. Not stored: worked out on read
   (`crm/src/lib/lead-origin.ts`) from the Lead's first touch, else the visit that sent the form, so improving the rules
   re-labels history. Tags win over the referring site; `gclid` means Google Ads; `fbclid` means Facebook.

The website records where a visitor came from (`src/lib/visit-touch.ts`, a tiny inline script on every page): a first
touch kept 90 days in localStorage, and the latest outside arrival this visit in sessionStorage. Before this, the
forms sent the form page and the previous page, so a visitor from Google who clicked through to the estimator was
recorded as coming from our own homepage.

Reports count what Staff entered in How they found us when the origin is unknown or direct (a caller who says
"Google" knows better than a missing visit). The Lead sources page shows both tables by month for 12 months, with Won.

## Consequences

- Texts and calls are `unknown` origin: a call carries no referrer. Telling Google Business Profile callers apart needs
  a separate Quo number on the profile (declined for now; the webhook can tag by number later).
- The Google Business Profile website link must carry `?utm_source=gbp&utm_medium=organic`; Google does not otherwise
  tell profile visits from search visits.
- Ads must carry UTM tags (`utm_source=facebook&utm_medium=paid_social`, Google Ads auto-tagging) to show as ads.
- Visitors who block storage, or switch devices, show the form visit only.
