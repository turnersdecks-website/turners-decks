---
status: accepted
---

# Estimator pricing and questions are edited in the CRM; each lead keeps a snapshot

Estimator prices and question wording lived in code (`src/lib/pricing.ts`, `src/lib/estimator-questions.ts`), so any
change needed a developer. They will move into the CRM's settings, stored in D1 and edited by the owner like a form.
Because the questions and prices can change after a visitor submits, every lead stores a snapshot of what that visitor
saw: the questions and options shown, their answers, and the resulting estimate. A later edit never rewrites an old
lead's estimate.

The settings supply numbers and words, not formulas. The owner can edit every price, label, hint and disclaimer,
turn options on or off, reorder them, and add options to list-style questions (a new material with its $/sqft, a new
railing style with its $/ft). The pricing formulas stay in code with their tests, so a brand-new question that
affects price is still a code change.

The owner edits a draft and publishes it; each publish is a numbered, unchangeable version. When the public estimator
opens, it fetches the latest published version's questions and options (no prices) from a public CRM endpoint, cached
at Cloudflare's edge. Run-time loading was chosen over rebuilding the site on each publish because the price only
appears after the contact gate submits to the CRM, so the estimator depends on the CRM being up either way.

**The CRM calculates the price, not the browser.** On submit, the browser sends the contact details, the answers and
the version number. The CRM prices the answers against that version, stores the Lead and its Estimate snapshot, and
returns the range, line items and flags for the browser to display. The figure the Homeowner sees is by construction
the figure stored, nobody can alter it in the browser, and the owner's prices are never published in the page's code.
The pricing engine therefore lives only in the CRM.

## Consequences

- The site no longer contains pricing code; `src/lib/pricing.ts` moves into the CRM.
- Live hints that need the engine during the questions (today's "Our estimate: about N ft" of railing) must be
  dropped or served by the CRM. Plain arithmetic such as total square feet can stay in the browser.

## Considered Options

- Keep the config in code and edit it by pull request: rejected, because the owner can't change prices without a developer.
- A full form builder with owner-defined questions and pricing rules: rejected for now; it needs a formula language
  and a way to test owner-written formulas.
- Calculate in the browser and have the CRM store the figure shown: rejected, because a bug or a tampered request
  could store a wrong price, and it ships the full price list to every visitor.
- Store only the answers and recompute on view: rejected, because a price or wording change would silently alter old
  leads.
