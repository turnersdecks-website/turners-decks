# Project rules

- Static Astro site. Keep pages as `.astro` with no client JavaScript unless a feature truly
  needs it; the only React islands are `QuoteForm` and `Estimator`.
- Business facts live in `src/lib/site.ts`. Estimator pricing config + engine live in
  `src/lib/pricing.ts` (tested in `pricing.test.ts`); question wording and disclaimers live in
  `src/lib/estimator-questions.ts`, so prices and copy are each edited in one place.
- Both forms POST to `/api/quote` (`functions/api/quote.ts`). The server validates with the same
  zod schemas as the browser (`src/lib/quote.ts`), recomputes estimator prices from the answers,
  stores the row in D1, and copies it to Airtable. Never trust prices sent by the browser.
- Schema changes go in a new numbered file in `migrations/`; never edit an applied migration.
- Town pages come from the `TOWNS` list (one dynamic route). Adding a town is a data change;
  the sitemap picks it up automatically.
- Google review text lives in `src/lib/reviews.ts`, copied word for word from Google. Do not add
  review rating schema.
- Photos go in `src/assets/images` and are referenced through `src/lib/photos.ts`. Strip GPS
  metadata before adding any photo. Never publish a customer's name or street address.
- The PA HIC number must stay visible on every page (footer).
- URLs have no trailing slash (`/services/pool-decks`). Keep existing slugs stable.
- Run `npm test` and `npm run build` before pushing.
