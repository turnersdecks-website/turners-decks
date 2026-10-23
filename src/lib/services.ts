import type { ServiceSlug } from "./site";

export const SERVICE_CONTENT: Record<
  ServiceSlug,
  { title: string; h1: string; intro: string; points: string[]; formValue: string; metaTitle: string; metaDesc: string }
> = {
  "new-decks": {
    title: "New Decks",
    h1: "New Deck Construction",
    intro: "A deck sized and built for how you actually use your yard, from a simple ground-level platform to an elevated deck off the kitchen.",
    points: ["Ground-level and elevated decks", "Composite, capped PVC, or pressure-treated wood", "Railings and stairs to match", "Permits and inspections handled"],
    formValue: "New deck",
    metaTitle: "New Deck Builder in Berks, Montgomery & Chester County PA",
    metaDesc: "Custom new decks in composite, capped PVC, and pressure-treated wood. Locally owned, permits handled. Free on-site estimates.",
  },
  "deck-replacement": {
    title: "Deck Replacement",
    h1: "Deck Replacement",
    intro: "If your deck is soft, splintering, or unsafe, patching it just delays the problem. We tear out the old deck and build a new one that's up to code.",
    points: ["Full tear-out and disposal", "New framing and footings where needed", "Upgrade to low-maintenance composite or PVC", "Permits and inspections handled"],
    formValue: "Deck replacement",
    metaTitle: "Deck Replacement in Berks, Montgomery & Chester County PA",
    metaDesc: "Replace your old, worn-out deck with a new one built to code. Tear-out, permits, and the build all handled by Turner's Decks.",
  },
  "pool-decks": {
    title: "Pool Decks",
    h1: "Pool Decks",
    intro: "Decks around above-ground and in-ground pools, built with materials that stand up to water and stay comfortable underfoot.",
    points: ["Above-ground pool surrounds", "Moisture-resistant composite and capped PVC", "Gates and railings for pool safety", "Permits and inspections handled"],
    formValue: "Pool deck",
    metaTitle: "Pool Deck Builder in Berks, Montgomery & Chester County PA",
    metaDesc: "Composite and PVC pool decks for above-ground and in-ground pools. Locally owned, permits handled. Get a free estimate.",
  },
};

export const townFaqs = (town: string) => [
  { q: `Do you build decks in ${town}, PA?`, a: `Yes. ${town} is part of our regular service area, within about 30 miles of our base in Douglassville.` },
  { q: `Do I need a permit for a deck in ${town}?`, a: `Most decks need a permit. We review the requirements for your property, file the application, get township approval, and handle the inspections for you.` },
  { q: "What materials do you build with?", a: "Composite, capped PVC, and pressure-treated wood." },
  { q: "Do you repair or stain decks?", a: "No. We focus on new decks, deck replacement, and pool decks. If your deck needs major repairs, we can replace it." },
  { q: "Is there a warranty?", a: "Yes. A 12-month workmanship warranty on our work, plus manufacturer warranties of up to 50 years depending on the material." },
  { q: "Do you offer financing?", a: "Yes, through Acorn Finance. Checking your rate won't affect your credit score." },
];
