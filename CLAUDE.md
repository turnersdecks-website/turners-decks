# Project rules

- Static Astro site. Keep pages as `.astro` with no client JavaScript unless a feature truly
  needs it; the only React islands are `QuoteForm` and `Estimator`.
- Business facts live in `src/lib/site.ts`. Estimator pricing config + engine live in
  `src/lib/pricing.ts` (tested in `pricing.test.ts`); question wording and disclaimers live in
  `src/lib/estimator-questions.ts`, so prices and copy are each edited in one place.
- Both forms email leads through Web3Forms, posting from the browser (`submitLead` in
  `src/lib/quote.ts`). The email body is built in `src/lib/lead.ts` (tested in `lead.test.ts`);
  estimator prices are always computed from the answers there. The access key lives in
  `SITE.web3formsKey`. It is public by design; do not move it to a server, since Web3Forms
  server-side submissions need a paid plan.
- There is no backend or database. Keep the site fully static.
- Town pages come from the `TOWNS` list (one dynamic route). Adding a town is a data change;
  the sitemap picks it up automatically.
- Google review text lives in `src/lib/reviews.ts`, copied word for word from Google. Do not add
  review rating schema.
- Photos go in `src/assets/images` and are referenced through `src/lib/photos.ts`. Strip GPS
  metadata before adding any photo. Never publish a customer's name or street address.
- The PA HIC number must stay visible on every page (footer).
- URLs have no trailing slash (`/services/pool-decks`). Keep existing slugs stable.
- Run `npm test` and `npm run build` before pushing.
