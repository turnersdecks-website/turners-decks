# Turner's Decks website

turnersdecks.com, rebuilt in [Astro](https://astro.build) from the Lovable design
(`turnersdecks-website/turners-deck-reimagined`). Same look; leaner build.

- **Pages** are static HTML. Most pages ship no JavaScript at all.
- **Two interactive pieces** (the quote form and the price estimator) are small React "islands".
- **Leads** go to one Cloudflare Pages Function, `/api/quote`, which saves every submission to a
  Cloudflare D1 database and copies it into Pat's Airtable Leads table.
- **Photos** in `src/assets/images` are resized and converted to WebP at build time.

## Run it locally

```sh
npm install
npm run dev                 # site only, http://localhost:4321 (forms won't submit)

npm run build               # full site + lead API, the way Cloudflare runs it:
npm run db:migrate:local
npm run preview             # http://localhost:8788
npm test                    # pricing engine + lead handling
```

## Deploy on Cloudflare Pages (one-time setup)

1. `npx wrangler d1 create turners-decks-leads` and paste the printed `database_id` into
   `wrangler.toml`.
2. `npm run db:migrate:remote`
3. In Cloudflare: Workers & Pages → Create → Pages → connect this GitHub repo.
   Build command `npm run build`, output directory `dist`.
4. Secrets (Settings → Variables and secrets, or `npx wrangler pages secret put NAME`):
   - `AIRTABLE_TOKEN`: Airtable personal access token, scope `data.records:write`, access to the
     Turner's Decks base only. Without it, leads still save to D1; they just don't reach Airtable.
   - `RESEND_API_KEY` + `FROM_EMAIL` (optional): emails each lead to `NOTIFY_EMAIL`. Needs a
     verified sending domain in Resend first.
5. Every push to `main` deploys. Pull requests get their own preview URL.

## Where things live

| What | File |
|---|---|
| Phone, email, hours, towns, services, HIC number | `src/lib/site.ts` |
| Estimator prices (all dollar values) | `src/lib/pricing.ts` |
| Estimator question wording and disclaimers | `src/lib/estimator-questions.ts` |
| Google reviews | `src/lib/reviews.ts` |
| Project photos and captions | `src/lib/photos.ts` + `src/assets/images/` |
| Service page copy, town FAQs | `src/lib/services.ts` |
| Page layouts | `src/pages/` |
| Lead API | `functions/api/quote.ts` (+ `src/lib/lead.ts`, `src/lib/airtable.ts`) |
| Lead database schema | `migrations/` |

## Reading leads

Airtable is where Pat works the leads. D1 is the backup copy of every submission:

```sh
npx wrangler d1 execute turners-decks-leads --remote \
  --command "select created_at, source, first_name, last_name, phone, estimate_low, estimate_high, airtable_id from quote_requests order by created_at desc limit 20"
```

A blank `airtable_id` means that lead didn't reach Airtable (token missing or Airtable was
down) and should be added by hand.

## What changed from the Lovable build

| Lovable | This build | Why |
|---|---|---|
| TanStack Start (React, server-rendered) | Astro static pages | Faster pages, nothing to run, cheaper to host |
| Supabase table, written from the browser | Cloudflare function + D1 | Checks the data on the server and keeps hosting and data in one account |
| Estimator prices saved as the browser sent them | Server recalculates from the answers | A visitor can't plant a fake price in a lead |
| No spam protection | Hidden honeypot field | Drops most form bots |
| Leads stayed in Supabase | Also copied to Airtable Leads (Stage = New) | Leads land where Pat already works |
| Images on Lovable's CDN | In the repo, auto-resized to WebP | Owned, smaller files |
| Google Fonts | Self-hosted fonts | No third-party request, slightly faster |
| Radix accordion | Native `<details>` | No JavaScript; FAQ text stays crawlable |
| — | PA HIC # in footer | Required on all advertising |
