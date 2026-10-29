# Turner's Decks CRM

The Staff CRM for Turner's Decks: website Leads, the Pipeline, the Lead page and the estimator's settings. It is a
port of Good Cover Roofing's CRM (branch `feat/crm-intake`, commit d493504), itself a cut-down copy of the Pine &
Gable CRM. The stack is unchanged: TanStack Start on a Cloudflare Worker, D1 through Drizzle, Better Auth, R2 for
Quote files, Resend through an email outbox. Decisions: `../docs/adr/0001-0003`. Words: `../GLOSSARY.md`.

- `npm run dev`: local dev on http://localhost:3000 (local D1 under `.wrangler/`)
- `npm test`: Vitest inside the Workers runtime, against local D1 with the migrations applied (`npm run test:quiet` keeps the output short)
- `npm run typecheck`
- `npm run db:generate`: writes a migration from `src/db/schema.ts` into `drizzle/`
- `npm run db:migrate:local`: applies the migrations to the local D1 that `npm run dev` and `npm run preview` use (`--env development`)
- Staging (FLW-204, needs a human): `npm run db:migrate:staging`, `npm run deploy:staging`

Local secrets go in `.dev.vars` (copy `.dev.vars.example`). Code follows `CODING_STANDARDS.md`.

## What it has

- **Intake** `POST /api/public/intake` (`src/lib/intake.ts`). The site's quote form and estimator post here from the
  browser. In order: a CORS allowlist (`INTAKE_ALLOWED_ORIGINS`), a per-IP rate limit, a 64 KB body cap, a
  `submission_key` lookup (a retry gets the stored result), Turnstile, storing the raw post as a Form submission,
  the honeypot (`website`), mapping, a dedupe on phone and email, then one D1 batch that writes the Lead, its
  activity, the stage history row and the email jobs.
- **Pipeline** `/crm`, **All Leads** `/leads`, **Lead page** `/leads/$id` (Homeowner, Activities, Quote tabs).
- **Staff auth**: `/sign-in`, `/forgot-password`, `/reset-password`, `/api/auth/*`. Every other page sits under
  `_staff`; every server function uses `requireStaff` or `requireAdmin` (`test/route-policy.test.ts`,
  `test/guards.test.ts`). The first admin comes from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` on the first
  sign-in; change that password afterwards.
- **Company settings** `/settings` and **Submissions** `/submissions` (admins).
- **Email outbox** (`src/lib/outbox.ts`, Resend) with a 5-minute cron for retries, backlog alarms and Quote file
  cleanup.
- **Customers and Jobs** `/customers`, `/jobs` (`src/lib/customers.server.ts`). Moving a Lead to won joins or makes
  its Customer and adds a Job (same D1 batch as the stage move). A past Customer's new website Lead is tied to them.
- **MCP for Claude** `/mcp` (`src/mcp/`). The Worker is its own OAuth server (`@cloudflare/workers-oauth-provider`,
  KV binding `OAUTH_KV`): Claude registers itself, the Staff member signs in with their CRM login and approves on
  `/oauth/authorize`, and every tool call runs as them (re-read each call, so a banned login stops at once). Tools read
  and write Leads, Follow-ups, Customers, Jobs, company settings (admin) and the estimator draft (admin, never
  publish). Nothing deletes.

## Connect Claude

In Claude: Settings > Connectors > Add custom connector, URL `<CRM address>/mcp` (for staging,
`https://turners-decks-crm-staging.<account>.workers.dev/mcp`). Claude opens the CRM sign-in, then the consent
page; Allow finishes it.

## Local end to end

```sh
cp .dev.vars.example .dev.vars   # set BETTER_AUTH_URL=http://localhost:4173
npm run db:migrate:local && npm run preview      # CRM on :4173
# in the repo root: cp .env.example .env, then
npx astro dev --port 4321                        # the only origin env.development allows
```

Without `RESEND_API_KEY`, emails stay queued (`email not sent: RESEND_API_KEY is not set`). Cron triggers don't run
under `vite preview`, so the Pipeline shows a "Background jobs have not run" banner locally. That is expected.
