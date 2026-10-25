# Turner's Decks website

turnersdecks.com, rebuilt in [Astro](https://astro.build) from the Lovable design
(`turnersdecks-website/turners-deck-reimagined`). Same look; leaner build.

- **Pages** are static HTML. Most pages ship no JavaScript at all.
- **Two interactive pieces** (the quote form and the price estimator) are small React "islands".
- **Leads** are emailed through [Web3Forms](https://web3forms.com). Each form posts straight from
  the visitor's browser; there is no backend or database to run.
- **Photos** in `src/assets/images` are resized and converted to WebP at build time.

## Run it locally

```sh
npm install
npm run dev       # http://localhost:4321
npm test          # pricing engine + lead email contents
npm run build     # static site in dist/
```

## Lead forms (Web3Forms)

1. Create an access key at web3forms.com using the inbox that should receive leads
   (e.g. turnersdecks@gmail.com). Leads go to the address the key was made with.
2. Paste the key into `web3formsKey` in `src/lib/site.ts` and push. The key is meant to be public;
   it can only send to that one inbox.
3. Submit the quote form and the estimator once on the live site and confirm both emails arrive.
   Check the spam folder the first time and mark them "Not spam".

Each email's reply-to is the customer's address, so replying goes straight to them. Estimator
emails include the price range shown, the project details, any items flagged for a site review,
and a full plain-text summary.

Free plan: 250 submissions a month, one recipient inbox. CC recipients, webhooks (to push leads
into a CRM automatically), and autoresponders need a paid plan.

Spam: a hidden honeypot field silently drops most bots. If spam gets through, Web3Forms supports
hCaptcha on the free plan.

## Deploy on Cloudflare Pages

Workers & Pages → Create → Pages → connect this GitHub repo. Build command `npm run build`,
output directory `dist`. Every push to `main` deploys; pull requests get a preview URL.
No environment variables are needed.

## Where things live

| What | File |
|---|---|
| Phone, email, hours, towns, services, HIC number, Web3Forms key | `src/lib/site.ts` |
| Estimator prices (all dollar values) | `src/lib/pricing.ts` |
| Estimator question wording and disclaimers | `src/lib/estimator-questions.ts` |
| What the lead emails contain | `src/lib/lead.ts` |
| Google reviews | `src/lib/reviews.ts` |
| Project photos and captions | `src/lib/photos.ts` + `src/assets/images/` |
| Service page copy, town FAQs | `src/lib/services.ts` |
| Page layouts | `src/pages/` |

## What changed from the Lovable build

| Lovable | This build | Why |
|---|---|---|
| TanStack Start (React, server-rendered) | Astro static pages | Faster pages, nothing to run, cheap to host |
| Supabase table, written from the browser | Web3Forms email | No database to maintain; leads land in the inbox |
| No spam protection | Hidden honeypot field | Drops most form bots |
| Images on Lovable's CDN | In the repo, auto-resized to WebP | Owned, smaller files |
| Google Fonts | Self-hosted fonts | No third-party request, slightly faster |
| Radix accordion | Native `<details>` | No JavaScript; FAQ text stays crawlable |
| — | PA HIC # in footer | Required on all advertising |
