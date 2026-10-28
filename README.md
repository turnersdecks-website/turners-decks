# Turner's Decks website

turnersdecks.com, rebuilt in [Astro](https://astro.build) from the Lovable design
(`turnersdecks-website/turners-deck-reimagined`). Same look; leaner build.

- **Pages** are static HTML. Most pages ship no JavaScript at all.
- **Two interactive pieces** (the quote form and the price estimator) are small React "islands".
- **Leads** go to the CRM (`crm/`, a separate Cloudflare Worker). Each form posts straight from the
  visitor's browser to the CRM intake; the site itself has no backend or database.
- **The estimator** loads its questions from the CRM's latest Published version, and the CRM
  prices the answers and returns the range shown.
- **Photos** in `src/assets/images` are resized and converted to WebP at build time.

## Run it locally

```sh
npm install
npm run dev       # http://localhost:4321
npm test          # CRM intake client + estimator step rules
npm run build     # static site in dist/
```

## Lead forms (CRM intake)

Copy `.env.example` to `.env`. `PUBLIC_CRM_URL` is the CRM's base URL (run the CRM with
`npm run dev` in `crm/`); `PUBLIC_TURNSTILE_SITE_KEY` is the Turnstile site key (Cloudflare's
always-pass test key `1x00000000000000000000AA` locally). The site's origin must be in the CRM's
`INTAKE_ALLOWED_ORIGINS`. Without both values the build warns and the forms cannot send.

Spam: a hidden honeypot field (`website`) and Cloudflare Turnstile. The CRM stores every lead and
emails the owner; see `crm/README.md`.

## Deploy on Cloudflare Pages

Workers & Pages → Create → Pages → connect this GitHub repo. Build command `npm run build`,
output directory `dist`. Every push to `main` deploys; pull requests get a preview URL.
Set `PUBLIC_CRM_URL` and `PUBLIC_TURNSTILE_SITE_KEY` as build environment variables.

## Where things live

| What | File |
|---|---|
| Phone, email, hours, towns, services, HIC number | `src/lib/site.ts` |
| Estimator prices, questions and disclaimers | CRM → Estimator settings (publish to go live) |
| What the forms send to the CRM | `src/lib/crm-intake.ts` |
| Google reviews | `src/lib/reviews.ts` |
| Project photos and captions | `src/lib/photos.ts` + `src/assets/images/` |
| Service page copy, town FAQs | `src/lib/services.ts` |
| Page layouts | `src/pages/` |

## What changed from the Lovable build

| Lovable | This build | Why |
|---|---|---|
| TanStack Start (React, server-rendered) | Astro static pages | Faster pages, nothing to run, cheap to host |
| Supabase table, written from the browser | Separate CRM (`crm/`) | Leads stored and followed up in one place |
| No spam protection | Honeypot field + Turnstile | Drops form bots |
| Images on Lovable's CDN | In the repo, auto-resized to WebP | Owned, smaller files |
| Google Fonts | Self-hosted fonts | No third-party request, slightly faster |
| Radix accordion | Native `<details>` | No JavaScript; FAQ text stays crawlable |
| — | PA HIC # in footer | Required on all advertising |
