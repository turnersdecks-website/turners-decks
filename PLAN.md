# Plan: Turner's Decks CRM with owner-editable estimator settings
_Round 2 — revised after Codex round 2 (see PLAN-REVIEW-LOG.md)_

Spec: Linear FLW-197; tickets FLW-198..204. Decisions: `docs/adr/0001-0003`. Vocabulary: `GLOSSARY.md`.
Reference build: Good Cover's CRM at `~/.t3/worktrees/Good Cover Roofing/feat-crm-intake/crm` (summary in
`docs/research/good-cover-crm.md`). Current site estimator: `src/lib/pricing.ts`, `src/lib/estimator-questions.ts`,
`src/components/islands/Estimator.tsx`, `src/lib/lead.ts`, `src/lib/quote.ts`.

## Goal
Add a separate CRM app (`crm/`, Cloudflare Worker + D1) to this repo by porting Good Cover's CRM whole, then move the
estimator's prices and wording into owner-editable, versioned Estimator settings in the CRM. Both site forms post to
the CRM intake; the CRM prices estimator submissions against the exact Published version the Homeowner answered,
stores an Estimate snapshot on the Lead, emails an Owner alert and an Estimate email, and returns the price for the
browser to show. Web3Forms and the site's copy of the pricing engine are removed.

## Approach
1. **Port (FLW-198).** Copy Good Cover `crm/` (minus `node_modules`, `.wrangler`, `dist`, `.dev.vars`) into `crm/`.
   Rename package/Worker/resource names; seed company settings with Turner's facts; deck wording in UI and emails;
   intake `source` values `quote_form` and `estimator` (Lead `source` stays `website`). Typecheck + tests green.
2. **Settings document + engine (FLW-199).** In `crm/src/lib/estimator/`:
   - `document.ts`: one zod schema `EstimatorDocument`: `questions[]` (key, label, help?, default?, kind
     `choice|multi|number|sections|zip|toggle`), each choice question's `options[]` (value, label, hint?, enabled,
     order, `reviewFlag?`, plus a question-specific `price` object, e.g. material `{newPerSqft, redeckPerSqft}`, height
     `{multiplier, skirtingHeightFt}`, stairs `{base, risers, railLfPerSide}`), `scalars` (minimum, markup, permit,
     gate, landing, closed riser, skirting door, privacy wall $/ft, stair opening ft, expansion %, redeck contingency),
     `ranges` (standard/uncertain/review spreads), `serviceArea` ZIP prefixes, `copy` (disclaimers, included, price
     factors, step titles).
   - Required option values per question (the engine's branches: `none`, `unsure`, `homeowner`, `deckingOnly`,
     `full`, `redeck`, `replacement`, `expansion`, `multiple`, `yes`, …) are enforced by validation; they can be
     relabelled and repriced but not removed. Disabling is allowed except for `none`/`unsure` where the engine needs
     a fallback (`unsure` may be disabled; engine never relies on it being shown).
   - `engine.ts`: `estimate(doc, answers) → EstimateResult` — today's `estimateProject` logic, reading every number
     from the document. Flags = union of the selected options' `reviewFlag` + the code-level ones (redeck rot /
     unstable / framing unknown, outside service area), de-duplicated, in a stable order.
   - **Locked vs data-driven questions (in code, not the document).** Options can be *added* only to data-driven
     lists whose meaning is fully carried by the option's price fields + `reviewFlag`: material, height, layout,
     access, railingSides, railingStyle, privacyWall, stairType, demolition, pattern, fascia, skirting, lighting,
     features. Locked questions (projectType, attached, slope, townhouse, hoa, historic, landing, skirtingCoverage,
     stairCount, stairRails, framingSound, rot, unstable, neighbors) allow relabel/hint/order/enable only; their
     value sets are fixed. Question keys and kinds are fixed for every question. Required branch values inside
     data-driven lists (`none` for railingSides/stairType/skirting/lighting/privacyWall, `homeowner`/`deckingOnly`/
     `full` for demolition, `unsure` where present) cannot be removed.
   - **Relevance rules are fixed in code for this release, not editable.** `relevance.ts` in the CRM defines, per
     question, the step it appears on and when it is shown (today's UI rules); `toPublic` emits them as
     declarative `showIf: [{question, in|notIn: [...]}]` in the public payload, so the site interprets them
     generically but the owner cannot change them. Rules only ever reference questions on the **same or an
     earlier step** (asserted by a test over the rule table). Fix vs today: when railingSides = none and
     stairType ≠ none, `railingStyle` is asked **on the Stairs step** (stair rails are priced at the railing
     style's $/ft); when railingSides ≠ none it is asked on the Railings step as now. A question is required iff
     relevant; the server strips irrelevant answers and the engine never reads them. Site validation runs per
     step and again for all steps before the contact gate, sending the Homeowner back to the first step with a
     missing answer (covers back-navigation that makes a question newly relevant). No server-side defaults exist; the document's per-question `default` is only a UI preselection and the
     site reports which answers are still on their default.
   - `answers.ts`: zod schema for answers built **from the document**: each choice an enabled option value of that
     version; multi-selects unique and ⊆ enabled options; sections 1–5 entries, each width/depth finite 3–100;
     railingLf absent or 1–1000; gates 0–2; stairCount 1–2; ZIP `^\d{5}$`. Unknown keys rejected.
   - **Document invariants (validated on save and publish):** unique question keys and option values; every
     relevant required question has ≥1 enabled option; prices finite 0–1,000,000; multipliers/shares 0–3;
     percentages 0–1; range spreads `0.5 ≤ low ≤ 0.95` and `1.05 ≤ high ≤ 2` (the 5% margin exceeds the largest
     half rounding step relative to the midpoint, 1,250 / 75,001 ≈ 1.7%, so rounding can never push low above or
     high below mid; the minimum floor keeps low ≤ mid because mid ≥ minimum), review ⊇ uncertain ⊇ standard;
     labels 1–200 chars, copy ≤ 2,000; ZIP prefixes 3 digits; total document ≤ 200 KB.
   - **Output guard:** engine result must be finite with `0 < low ≤ mid ≤ high`; otherwise intake marks the
     submission failed (500, logged with version) rather than storing or showing a bad price.
     **Clamped rounding (the guarantee does not rely on the spread margin alone):** mid is rounded to whole
     dollars; `low = max(min(roundStep(mid·lo), floorStep(mid)), minimum)` and
     `high = max(roundStep(mid·hi), ceilStep(mid))`, where the step is today's $500/$1,000/$2,500 by size.
     Because mid ≥ minimum after the minimum floor, this gives `low ≤ mid ≤ high` for every input. The minimum
     project price must be a whole number of dollars, ≥ $1,000 and a multiple of $500; unit prices may have cents.
     Tests cover the tightest allowed spreads (0.95/1.05) across rounding-step boundaries ($25k, $75k), at the
     minimum price, at the smallest allowed minimum ($1,000) and with fractional unit prices, so every publishable document keeps `low ≤ mid ≤ high`.
   - `ENGINE_REVISION` constant stored on every snapshot.
   - `seed.ts`: the v1 document generated from today's `pricing.ts` + `estimator-questions.ts`, no defaults.
   - Tests: port `pricing.test.ts` against the seed (golden $38k–$47k), plus added-option priced/flagged, validation
     errors, answer validation.
3. **Storage + publish (FLW-200).** Migration `0001`: `estimator_draft` (id=1, document_json, revision INTEGER,
   updated_at, updated_by). Save is compare-and-swap on `revision` (stale → 409 "someone else saved; reload");
   publish takes the revision the owner reviewed and only publishes if it is still current, `estimator_versions` (version INTEGER PK, document_json, published_at, published_by; no UPDATE path
   in code), `estimate_snapshots` (id, lead_id, submission_id UNIQUE, version, questions_json, answers_json,
   defaulted_json, line_items_json, low, mid, high, flags_json, service_area, created_at). Migration seeds draft and
   version 1 from the seed document (SQL generated from `seed.ts` by a script, committed). `company_settings` gains
   `estimate_email_template`. Server functions with `requireAdmin` for save/publish, `requireStaff` for reads.
   Publish = validate draft → `INSERT INTO estimator_versions (version, …) SELECT COALESCE(MAX(version),0)+1 …` in
   one statement so concurrent publishes cannot share a number.
4. **Public read + priced intake (FLW-201).**
   - `GET /api/public/estimator` returns `toPublic(latestVersion)`: version, questions, option value/label/hint/order
     (enabled only), defaults, copy. No prices, no review flags. CORS from the intake allowlist. `Cache-Control:
     public, max-age=60` (short TTL instead of purge-on-publish; simpler, at most one minute stale, and stale is
     safe because intake prices against the version sent).
   - **Turner's field mapper** replaces Good Cover's `mapSitePayload`: both forms send `first_name`, `last_name`,
     `email`, `phone`, `zip` (required, separate from the optional `address`), plus quote form `project_type`,
     `approx_size`, `material`, `notes`, and estimator `timing`, `contact_method`, `wants_financing`, `notes`,
     `address`. Every collected field lands on the Lead or the `form` activity summary, covered by contract tests.
   - Intake: `source: estimator` payload carries `version` and `answers`. In `processSubmission`, after mapping:
     load that version (missing → rejected 422 `unknown_version`), validate answers against it (invalid → 422),
     `estimate()`, then in the same D1 batch as the Lead insert the `estimate_snapshots` row and put the public
     result (low, high, flags, belowMinimum, serviceArea, lineItems) in the response body — which the ported code
     already stores as `result_json`, so idempotent retries return the identical price.
   - Outbox: Owner alert body gains range/flags/timing; new kind `estimate_email` replaces `form_ack` for estimator
     submissions. **Rendered and frozen at enqueue** (recipient, subject, body stored in the job payload) from the
     template and this submission's snapshot + submitted first name only, so a retry never changes content and never
     shows another submission's or the matched Lead's data.
   - **Recipient:** the Estimate email goes to the email **submitted in this Form submission**, never to a matched
     Lead's stored email (its content is only what this visitor just saw). A conflicting match keeps the ported
     review note + `needs_review` on the Lead.
   - Replay from `/submissions`: processed submissions return their stored result (ported behaviour, no recompute);
     a failed/rejected one is priced with the current engine against its stored version — the Homeowner never saw a
     price for it, so there is nothing to stay consistent with. UNIQUE submission_id keeps one snapshot.
5. **Site (FLW-202).** Write `src/lib/crm-intake.ts` from Good Cover's `crmIntake.ts` (Turnstile token, submission
   key) but returning a typed, validated result: `{kind: 'estimate', result}` | `{kind: 'received'}` (quote form,
   or honeypot success with no estimate) | throws. Retries with the **same key and payload**, at most 3 attempts with
   backoff, on network errors, timeouts (10 s abort), 5xx and 202 pending; rotates the key only on 409 (as ported);
   4xx otherwise is final. Tests cover each branch with a fake fetch. QuoteForm posts `source: quote_form`. Estimator island: fetch public settings on mount
   (loading / error-with-tap-to-call states), render the same nine steps from the document, contact gate posts
   `source: estimator` + version + answers, renders the returned result. sessionStorage key includes the version;
   restored answers are filtered through the loaded document (unknown keys/values dropped). Delete `pricing.ts`,
   `estimator-questions.ts` copy now owned by the CRM, `lead.ts`, Web3Forms code and `SITE.web3formsKey`; site keeps
   `totalSqft` arithmetic. Contract test in `crm/test/` imports `../../src/lib/crm-intake.ts` payload builders.
   Rewrite the affected CLAUDE.md rules.
6. **CRM UI (FLW-203).** `/settings/estimator`: form over the draft document grouped by step; add-option button on
   list questions; Save draft (field errors), Publish (confirm dialog, shows live version/date/by). Template field on
   `/settings`. Lead page Estimate tab listing snapshots.
7. **Manual (FLW-204).** Documented in `crm/README.md`; not done by code.

## Key decisions & tradeoffs
- **Document-per-version JSON** rather than normalized price tables: one immutable blob per publish makes snapshots
  and "price against version N" trivial; cost is that querying "all materials" needs JSON parsing (fine at this size).
- **Engine formulas stay in code**; the document supplies numbers, wording, flags and extra list options only.
- **Short edge TTL instead of cache purge** on publish (no Cloudflare API token in the Worker).
- **Snapshot stores the questions as shown** (labels of the version) duplicated per Lead, so a Lead page never needs
  to resolve an old version; the version row is still kept.
- **Estimate email replaces the acknowledgement** for estimator submissions; quote form keeps the ported ack.
- **Dedupe semantics unchanged**: a repeat Homeowner's estimator submission attaches a new snapshot to the existing
  Lead.
- **Site keeps the sessionStorage restore** but validates against the loaded version.

## Risks / open questions
- Good Cover's Turnstile and rate limiting need real keys in staging; locally the ported dev fakes are used.
- The engine branches on specific option values; validation must stop Pat deleting them, and the editor must say so.
- Cross-origin: the site (Pages) and CRM (Worker) are different origins until DNS moves; CORS allowlist per env.
- Free-tier Worker CPU limit (10 ms): the engine is cheap, but zod-parsing a large document per intake must stay
  fast; parse once per request.
- Body cap 64 KB is ample for answers.
- The contract test imports site code from inside the Workers test runtime; Good Cover shows it works.

## Out of scope
Full form builder (new questions/formulas), SMS, appointments, WordPress lead import, dashboards, changing the step
structure, showing a price when the CRM is down, DNS/Resend/Turnstile account setup (FLW-204, human).
