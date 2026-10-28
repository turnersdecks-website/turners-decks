# Good Cover Roofing CRM: how it is built

Research notes for adding a backend CRM and owner-editable estimator settings to Turner's Decks. Read-only survey,
2026-10-27.

## Where the CRM actually is

- `main` (1fdbef6) has **no CRM**. It is a static Astro site plus one Cloudflare Pages Function that emails the
  inspection form to the owner through Resend (`README.md:3`, `functions/api/inspection.ts:1-2`).
- The CRM lives only on branch **`feat/crm-intake`** (single commit d493504, not merged; checked out at
  `~/.t3/worktrees/Good Cover Roofing/feat-crm-intake`). It adds `crm/`, `docs/adr/0001-...`, `src/lib/crmIntake.ts`
  and edits `src/components/InspectionForm.astro`.
- It is a **cut-down copy of the Pine & Gable CRM** (`SK_Services/PIne & Gable/crm` at commit 10d25d9). Good Cover
  explicitly keeps P&G's stack decisions and does not revisit them (`docs/adr/0001-crm-ported-from-pine-and-gable.md:3-6`).
  The **estimator/pricing feature was left out** (`docs/adr/0001-...:12-13`, `crm/README.md:57`).

Citation convention: paths are relative to the Good Cover repo root. `crm/...`, `docs/adr/...` and
`src/lib/crmIntake.ts` are on `feat/crm-intake`. Lines prefixed **P&G:** are in the Pine & Gable repo (outside Good
Cover), cited only where Good Cover defers to it.

## 1. Stack and hosting

| Piece | What | Source |
| --- | --- | --- |
| Public site | Astro 7, `output: 'static'`, Tailwind v4, Cloudflare Pages | `package.json:14`, `astro.config.mjs:12`, `wrangler.jsonc:1-5`, `README.md:3` |
| Site fallback form handler | Pages Function `POST /api/inspection` → Resend | `functions/api/inspection.ts:1-2,85-89` |
| CRM app | **Separate app** in `crm/`: TanStack Start (React 19) on a **Cloudflare Worker** | `crm/README.md:3-5`, `crm/package.json:39-40,48`, `crm/wrangler.jsonc:30-33`, `crm/src/server.ts:5-8` |
| DB | **Cloudflare D1** (SQLite), binding `DB` | `crm/wrangler.jsonc:49-56` |
| ORM / migrations | **Drizzle** (`drizzle-orm` 0.45.4, `drizzle-kit`), SQL in `crm/drizzle/`, applied with `wrangler d1 migrations apply` | `crm/package.json:15-16,46,63`, `crm/drizzle.config.ts:3-8`, `crm/drizzle/meta/_journal.json` (one migration, `0000_init`) |
| Auth | **Better Auth** 1.7.7 on D1 (email + password, admin plugin) | `crm/package.json:42`, `crm/src/lib/auth.ts:30-68` |
| File storage | Private **R2** bucket `LEAD_FILES` (Quote files) | `crm/wrangler.jsonc:23-26,57` |
| Email | **Resend** via an outbox table + retries | `crm/src/lib/outbox.ts:9-12,18-19` |
| Spam | **Cloudflare Turnstile** + Workers **Rate Limiting** bindings | `crm/src/lib/turnstile.ts:1-2`, `crm/wrangler.jsonc:44-47` |
| Background | Cron trigger every 5 min (outbox retry, backlog alarms, R2 cleanup) | `crm/wrangler.jsonc:48`, `crm/src/lib/cron.ts:29-32` |
| UI kit | Radix + shadcn-style components, TanStack Table, lucide, sonner | `crm/package.json:23-53`, P&G ADR 0006 referenced in `docs/adr/0001-...:5` |

Environments: top level = production, `env.staging`, `env.development` (local) each with their own D1, R2 and rate
limiter namespaces (`crm/wrangler.jsonc:4,58-112`). Free-tier constraints shape code: PBKDF2 instead of scrypt for the
10 ms CPU limit (`crm/src/lib/password.ts:3-7`), 40 Resend calls per sweep for the 50-subrequest limit
(`crm/src/lib/outbox.ts:25-26`).

Env/secret **names only**:
- Site main: `RESEND_API_KEY`, `LEAD_TO_EMAIL`, `LEAD_FROM_EMAIL` (`.dev.vars.example`, `README.md:22`).
- Site branch: `PUBLIC_CRM_INTAKE_URL`, `PUBLIC_TURNSTILE_SITE_KEY` (`.env.example:4-5`).
- CRM: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `TURNSTILE_SECRET_KEY`,
  optional `RESEND_API_KEY`, `EMAIL_FROM`; vars `ENVIRONMENT`, `INTAKE_ALLOWED_ORIGINS` (`crm/.dev.vars.example`,
  `crm/wrangler.jsonc:6-20,36-43`).

## 2. Data model (`crm/src/db/schema.ts`)

IDs are `crypto.randomUUID()` text; times are epoch ms (`schema.ts:4,97`). Enums are TS `as const` arrays mirrored by
SQL `CHECK` constraints (e.g. `schema.ts:99-100,176-179`).

- **Better Auth**: `user` (with `role` admin|staff, `banned`), `session`, `account` (password hash), `verification`
  (`schema.ts:10-11,23-94`).
- **`form_submissions`**: raw, immutable post; `submission_key` UNIQUE (client idempotency key), `fingerprint`,
  `schema_version`, `raw_body`, `ip_hash` (`schema.ts:105-115`).
- **`submission_processing`**: mutable intake state per submission: `state` received|processing|processed|rejected|failed,
  `lead_id`, `result_json`, `claimed_until` lease, `attempts` (`schema.ts:102,117-138`).
- **`leads`** (the core entity; there is no separate contacts/jobs table): name, email + `email_lower`, phone +
  `phone_e164`, street/city/state/zip, `stage` (default `new`), `source`/`first_source` (immutable), `service_type`,
  `message`, `assigned_to` → user, `lead_score` (unused at Good Cover, `docs/adr/0001-...:22`), `attribution_json`,
  `first_touch_json`, `needs_review`, `address_key`, plus Estimate-era columns `active_leak`, `roof_answers_version`
  kept for a future port. Partial UNIQUE indexes on `phone_e164` and `email_lower` enforce dedupe (`schema.ts:140-183`).
- **Pipeline stages**: `new, contacted, appointment, quoted, won, lost` (`schema.ts:99`; labels/styles
  `crm/src/lib/pipeline.ts:5-24`).
- **`lead_activity`** (notes/calls/emails/texts/form/appointment, plus Follow-ups via `follow_up_at` /
  `follow_up_done_at`, `author_id`, `dedupe_key` UNIQUE, email `dispatch_state`) (`schema.ts:185-218`).
- **`lead_stage_changes`**: stage history, one row per actual change, written in the same batch as the stage update
  (`schema.ts:220-236`; helpers `crm/src/lib/stage-history.server.ts:5-49`).
- **`lead_files`**: Quote files in five slots (hover report, materials list, customer quote, signed quote, contractor
  agreement), soft-replace, one current file per slot, 25 MiB cap, bytes in R2 (`schema.ts:238-282`).
- **`r2_prefix_deletes`**: R2 cleanup queue after a Lead delete (`schema.ts:284-291`).
- **`consent_events`**: append-only SMS consent log (`schema.ts:293-319`).
- **`notification_jobs`**: email outbox and delivery log (`schema.ts:321-355`).
- **`cron_runs`**, **`alarm_days`**: cron health and alarm dedupe (`schema.ts:357-371`).
- **`company_settings`**: single row (`CHECK id = 1`): name, phone, email, service area, business number, timezone,
  `owner_alert_emails`, `texting_enabled`. Seeded by the migration (`schema.ts:373-391`,
  `crm/drizzle/0000_init.sql:257`).

Not present: estimates, products/pricing, appointments, jobs, contacts as a separate table. The schema keeps P&G's
column names so those can be ported with additive migrations (`schema.ts:5-8`, `crm/README.md:51-62`).

## 3. Auth

- Email + password only; **public sign-up disabled** (`crm/src/lib/auth.ts:34-36`). Password reset through the outbox
  (`auth.ts:40-60`); sessions revoked on reset (`auth.ts:37`).
- **First admin** is created from `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` on the first sign-in attempt while no admin
  exists; inert afterwards (`crm/src/lib/seed-admin.ts:9-35`, called from `crm/src/routes/api/auth/$.ts:16-17`).
- **Roles**: `admin` and `staff` (`schema.ts:10`, `auth.ts:12-14,66`). Admin-only: company settings, Lead delete,
  Submissions list/replay, staff list (`crm/src/lib/settings.functions.ts:30-31`, `leads.functions.ts:302-303`,
  `submissions.functions.ts:18-19,72-73`, `staff.functions.ts:19-20`).
- **Protection is two layers**:
  1. Every page except `/sign-in`, `/forgot-password`, `/reset-password` is under the `_staff` layout, whose
     `beforeLoad` redirects to `/sign-in` on a 401 (`crm/src/routes/_staff.tsx:19-32`).
  2. Every server function uses `requireStaff` or `requireAdmin` middleware (401/403 thrown server side)
     (`crm/src/lib/guards.ts:6-22`).
- CSRF middleware on all server functions (`crm/src/start.ts:3-12`); POST server routes call `isSameOrigin`
  (`crm/src/lib/same-origin.ts:1-12`).
- Better Auth's `/api/auth/admin/*` endpoints are blocked (404) (`api/auth/$.ts:8-13`). Sign-in and reset are rate
  limited per IP and per email (5/min) (`crm/src/lib/auth-rate-limit.ts:1-27`, `crm/wrangler.jsonc:46`).
- Route policy is enforced by a test that enumerates every route and asserts only the listed ones are public
  (`crm/test/route-policy.test.ts:6-11`).

## 4. How leads arrive

**Branch flow (CRM configured):**
1. The Astro form keeps `action="/api/inspection"` but, when `PUBLIC_CRM_INTAKE_URL` and `PUBLIC_TURNSTILE_SITE_KEY`
   are set at build time, a script renders Turnstile and posts JSON to the CRM instead
   (`src/components/InspectionForm.astro` diff; `src/lib/crmIntake.ts:1-7`). With JS off or vars unset it falls back to
   the Pages Function (`docs/adr/0001-...:19-21`, `README.md` "CRM intake" section).
2. Payload: mapped fields, UTM/click ids, landing/referrer, device type, a per-answers `submission_key`, and the
   Turnstile token (`src/lib/crmIntake.ts:20-65`). The client retries 202 "pending" up to 3 times and rotates the key
   on 409 (`crmIntake.ts:79-126`).
3. `POST /api/public/intake` (`crm/src/routes/api/public/intake.ts:5-13`) → `handleIntake`, in order
   (`crm/src/lib/intake.ts:12-14`, `crm/README.md:19-31`):
   - CORS allowlist from `INTAKE_ALLOWED_ORIGINS` (`intake.ts:59-75`)
   - per-IP rate limit 10/min, fails open (`intake.ts:77-81`)
   - 64 KB body cap (`intake.ts:17,92-93`)
   - `submission_key` lookup so a retry returns the stored result without re-spending Turnstile (`intake.ts:99-103`)
   - Turnstile siteverify with hostname + action checks; strict outside `development` (`intake.ts:105-120`,
     `crm/src/lib/turnstile.ts:28-56`)
   - store raw body + claim lease in one batch (`intake.ts:122-151`)
   - honeypot field `website` → pretend success, mark rejected (`intake.ts:271-274`)
   - map + validate (name plus phone or email required; email syntax; US phone → E.164; address split)
     (`intake.ts:524-561`)
   - dedupe on phone then email; matched Leads only get empty fields filled; conflicting matches get a review note and
     `needs_review` (`intake.ts:309-347,486-514`)
   - **one D1 batch**: Lead insert/update, stage history, `form` activity, consent event, outbox jobs, processing state
     fenced on the lease (`intake.ts:348-429`).
4. **Notifications**: `owner_alert` email to `company_settings.owner_alert_emails` (else company email), and a
   `form_ack` to the Homeowner if they gave an email (`intake.ts:392-411`, `crm/src/lib/outbox-kinds.ts:26-34,47-70`).
   First send attempt right after the response; cron retries with backoff, max 6 attempts (`outbox.ts:9-12,20-24`).
   With no `RESEND_API_KEY`, jobs stay queued (`crm/wrangler.jsonc:17-22`). **No SMS** in v1 (texting excluded,
   `docs/adr/0001-...:12`; `texting_enabled` stays false, `schema.ts:375`).
5. Admins can **replay** any stored Form submission from `/submissions` (`intake.ts:189-205`,
   `crm/src/routes/_staff/submissions.tsx:70-73`).

**Main / fallback flow**: Pages Function validates fields, checks honeypot `company`, caps body at 16 KB, and emails
through Resend; nothing is stored (`functions/api/inspection.ts:8,40-61,84-98`).

## 5. Admin / CRM UI (`crm/src/routes/_staff/`)

- `/` redirects into the app (`index.tsx`).
- **Pipeline `/crm`**: kanban column per stage, drag on desktop, stage picker on phones, **+ New Lead** dialog,
  banner when cron hasn't run in 15 min (`crm.tsx:21-22,55,83,98,135,164,195`; server `leads.functions.ts:33-56,59-82,84-102`).
  Loads up to 2000 Leads (`leads.functions.ts:55`).
- **All Leads `/leads`**: client-side data table of the newest 200 with global search (name/phone/email) and
  Stage/Source facets (`leads.tsx:13-24,76-81`, `leads.functions.ts:13-30`).
- **Lead page `/leads/$id`**: tabs Homeowner (editable fields, Stage, Assigned to), Activities (log note/call/email/text,
  optional Follow-up, stage history, form submissions), Quote (file slots); admin delete with confirm
  (`leads_.$id.tsx:51,212,249,275-282`). Logging a call/email/text auto-moves `new` → `contacted`; a note does not
  (`leads.functions.ts:220-264`, `crm/GLOSSARY.md:27`). Edits are fenced against concurrent address changes and return
  409 (`leads.functions.ts:118-158`).
- **Settings `/settings`**: admins edit company info and Owner alert emails; staff can only rename themselves
  (`settings.tsx:19-49`, `settings.functions.ts:21-71`).
- **Submissions `/submissions`** (admin): raw Form submissions with intake state, replay
  (`submissions.functions.ts:15-73`).
- Command menu, sidebar, theme switch (`crm/src/components/layout/*`).
- Not in v1: dashboard, Estimates, appointments, calls/SMS, follow-up queue, team invites (`crm/README.md:51-62`).

## 6. Estimator / pricing settings

**Good Cover has none.** No estimator exists on the site or in the CRM; the site deliberately publishes no prices
(`src/pages/new-roof-cost.astro:42`). The ADR lists "Estimates and Google Solar" as deferred
(`docs/adr/0001-...:12`), and the schema only keeps placeholder columns for them (`schema.ts:167-170`). So nothing about
storage, versioning, validation or public consumption of pricing can be learned from Good Cover itself.

The source it defers to, **Pine & Gable** (commit 10d25d9), does have owner-editable pricing. Brief pointer, not a full
survey:
- Tables `roofing_products` (name unique NOCASE, `offered`, `sort`, `waste_pct`, `minimum_job_cents`) and
  `pitch_bands` (per-product pitch range, `price_per_square_cents` nullable, `hand_quote`) (P&G:
  `crm/src/db/schema.ts:466-505`). Money in integer cents.
- Admin-only save, staff read; bands replaced as a whole in one batch; server-side validation (bands must cover pitch
  0–99 with no gaps/overlaps; waste 0–50%; price cap $10,000/square) returning field errors (P&G:
  `crm/src/lib/products.functions.ts:14-42`, `crm/src/lib/products.server.ts:37-60`).
- UI: "Roofing products & pricing" section of `/settings` (P&G: `crm/src/routes/_staff/settings.tsx:30,49,313`,
  `crm/src/components/estimate-settings.tsx`).
- **Versioning is by snapshot, not history**: a saved Estimate freezes its priced lines in `lines_json` and
  `complexities_json` with no FK to products, "so the snapshot outlives product edits" (P&G:
  `crm/src/db/schema.ts:611-630`). Product edits themselves are last-write-wins (P&G: `products.functions.ts:21-24`).
- **Not consumed by a public estimator**: P&G's only public CRM routes are intake, Retell and Twilio webhooks (P&G:
  `crm/src/routes/api/public/*`); pricing is used by Staff inside the CRM. Whether P&G's site widget
  (`site/src/components/islands/HomeQuoteTeaser.tsx`) uses CRM prices was not checked.

## 7. Testing and notable patterns

- **Vitest inside the Workers runtime** (`@cloudflare/vitest-plugin`) against local D1 with real migrations applied per
  run (`crm/vitest.config.ts:4-17,39`; `crm/README.md:9`). 59 files in `crm/test/`; the commit reports 388 passing tests
  (commit d493504 message; not re-run here).
- Fake outside services through seams (`fetch` option on dispatch, `mockResend`, `mockSiteverify`), **not `vi.mock`**
  (`crm/CODING_STANDARDS.md:9-10`).
- **Contract test across repos**: `crm/test/intake-contract.test.ts:1-8` imports the site's own `src/lib/crmIntake.ts`
  and posts its real payload to the real intake.
- Route-policy and guard enumeration tests (`crm/test/route-policy.test.ts`, `crm/test/guards.test.ts`).
- Site main has no unit tests; only a copy linter in the build (`package.json:7`, `scripts/lint-copy.mjs`).

Patterns worth copying:
- Store the raw post first, then process: a validation bug never loses a lead (P&G ADR 0003, `intake.ts:122-151`).
- Client idempotency key + fingerprint + lease-fenced batches (`intake.ts:96-103,181-187,412-428`).
- Transactional outbox for email with retries and a delivery log (`outbox.ts:9-12`, `schema.ts:324-355`).
- Stage history written atomically with stage changes (`stage-history.server.ts:5-11`).
- Public intake never overwrites identity fields on a matched lead (`intake.ts:318-320,486-489`).
- `GLOSSARY.md` + `CODING_STANDARDS.md` + `ponytail:` comments for accepted limits (`crm/CODING_STANDARDS.md:5-12`).

Pitfalls / tech debt:
- Placeholder D1 `database_id`s and staging origin; real deploy "needs Kevin" (`crm/wrangler.jsonc:4-5,53,94-97`).
  Seeded company phone looks like a placeholder (`crm/drizzle/0000_init.sql:257`).
- Stale comments: "migration 0003 seeds it" but only `0000_init` exists (`settings.server.ts:12`, `intake.ts:394`);
  `api/auth/$.ts:10` references `src/lib/team.functions.ts`, which is not in the branch.
- Admin role keeps Better Auth impersonation permission, decision pending (`auth.ts:12-13`).
- PBKDF2 at 100k rounds, below OWASP (`password.ts:5-6`); auth rate limit is per Cloudflare location
  (`auth-rate-limit.ts:2-4`).
- Large footprint for a v1: 200 files, ~42k lines including a 16k-line generated `worker-configuration.d.ts` and many
  copied UI primitives (`git diff --stat main...feat/crm-intake`).
- Two apps, two deploys (Pages site + Worker CRM), cross-origin CORS + Turnstile between them.

## 8. Implications for Turner's Decks

What maps directly:
- Turner's has the exact starting point P&G had: Astro site emailing via Web3Forms from the browser
  (Turner's `src/lib/quote.ts:49-70`). P&G ADR 0003 replaced Web3Forms with a direct post to a CRM intake because
  Web3Forms webhooks are paid (P&G: `docs/adr/0003-forms-post-directly-to-crm-intake.md:1-3`). The Good Cover port
  shows that pattern reused with a fallback path kept.
- Good Cover's v1 scope (intake, pipeline, lead page, staff auth, company settings, submissions replay) is a ready
  template for the CRM half. Stages `new … won/lost` fit a deck contractor as-is.
- The intake contract test pattern fits Turner's `lead.ts`/`lead.test.ts` split well (site module imported by CRM tests).

What would need to change or be decided:
- **CLAUDE.md rules flip**: "no backend or database", "keep the access key in `SITE.web3formsKey`" and "Web3Forms
  posting from the browser" would all change. Decide whether Web3Forms stays as a fallback (Good Cover kept its Resend
  function as fallback) or is removed (P&G removed it).
- **Separate CRM app vs. in-site backend**: Good Cover/P&G run the CRM as its own TanStack Start Worker. Alternatives
  (Astro server endpoints / Cloudflare adapter in the same project) are not explored in either repo. Open decision.
- **Hosting target for Turner's** is not known from this research; the Good Cover stack assumes Cloudflare (Pages +
  Workers + D1 + R2 + Turnstile + Rate Limiting).
- **Estimator settings have no Good Cover precedent.** The nearest model is P&G's roofing products + pitch bands, which
  is staff-side only. Turner's needs something different: the **public** estimator must read owner-edited prices.
  Open questions: rebuild the static site on price change vs. fetch prices at runtime from a public read endpoint;
  how to keep `pricing.test.ts` meaningful when values move to a DB (e.g. keep the engine pure in TS, store only the
  config, validate with the same schema on save); whether question wording (`estimator-questions.ts`) also becomes
  editable or stays in code.
- **Price versioning**: P&G only snapshots prices onto saved estimates. Turner's `lead.ts` already "computes estimator
  prices from the answers"; decide whether a lead stores the computed price and the pricing-config version used.
- **Cost/tier**: Good Cover code is tuned for Workers Free limits (`password.ts:3-7`, `outbox.ts:25-26`). Resend
  needs a verified sending domain (`README.md:22`).
- **Privacy rules carry over**: Turner's "never publish a customer's name or street address" maps to keeping Quote
  files in private R2 served only with a session (`crm/wrangler.jsonc:23-26`).
- **Size**: porting the full Good Cover CRM is ~200 files. Decide whether to copy it (fastest, consistent with sibling
  projects) or build a smaller subset.
