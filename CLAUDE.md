# Project rules

- Static Astro site. Keep pages as `.astro` with no client JavaScript unless a feature truly
  needs it; the only React islands are `QuoteForm` and `Estimator`.
- Business facts live in `src/lib/site.ts`. Estimator questions, options, disclaimers and prices
  live in the CRM's Estimator settings; the estimator island loads the latest Published version
  (`GET /api/public/estimator`, no prices) and the CRM prices the answers (`docs/adr/0003`). The
  site has no pricing code: do not add any. Its types and step rules mirror the CRM in
  `src/lib/estimator-public.ts`, and it never imports `crm/` code.
- Both forms post leads from the browser to the CRM intake through `src/lib/crm-intake.ts`
  (payload builders + `submitToCrm`, tested in `crm-intake.test.ts` and against the real intake in
  `crm/test/intake-contract.test.ts`), with Turnstile and the `website` honeypot
  (`docs/adr/0002`). Build-time env: `PUBLIC_CRM_URL`, `PUBLIC_TURNSTILE_SITE_KEY`
  (`.env.example`). Keep the builders free of Astro and browser globals.
- The CRM is a separate app in `crm/` (Cloudflare Worker + D1, `docs/adr/0001`) with its own
  rules, dependencies and tests. The public site stays fully static: no server code or database.
- Town pages come from the `TOWNS` list (one dynamic route). Adding a town is a data change;
  the sitemap picks it up automatically.
- Google review text lives in `src/lib/reviews.ts`, copied word for word from Google. Do not add
  review rating schema.
- Photos go in `src/assets/images` and are referenced through `src/lib/photos.ts`. Strip GPS
  metadata before adding any photo. Never publish a customer's name or street address.
- The PA HIC number must stay visible on every page (footer).
- URLs have no trailing slash (`/services/pool-decks`). Keep existing slugs stable.
- Run `npm test` and `npm run build` before pushing.
