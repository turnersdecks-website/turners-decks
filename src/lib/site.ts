// Single source of truth for business facts. Bracketed values are placeholders
// waiting on real details from the owner.
export const SITE = {
  name: "Turner's Decks",
  owner: "Pat Turner",
  since: 2018,
  phone: "(484) 824-0373",
  phoneHref: "tel:+14848240373",
  email: "turnersdecks@gmail.com",
  city: "Douglassville",
  state: "PA",
  hours: "Mon–Fri 7 AM–6 PM · Sat & Sun 9 AM–5 PM", // matches Google Business Profile
  hic: "PA135647", // PA Home Improvement Contractor number: required on all advertising, including the website
  // Web3Forms access key (web3forms.com). Public by design: it only lets this form email
  // the address the key was created with. Leads go to that inbox.
  web3formsKey: "", // [KEY] paste the access key here
  financingUrl: "", // [LINK] Acorn Finance page; the "Check your rate" button stays hidden until this is set
  url: "https://turnersdecks.com", // [DOMAIN] update when known
};

export const SERVICES = [
  {
    slug: "new-decks",
    title: "New Decks",
    short: "A new deck built from scratch, designed around how you use your yard.",
  },
  {
    slug: "deck-replacement",
    title: "Deck Replacement",
    short: "Old deck worn out or unsafe? We tear it out and build a new one that lasts.",
  },
  {
    slug: "pool-decks",
    title: "Pool Decks",
    short: "Slip-resistant, low-maintenance decks around above-ground and in-ground pools.",
  },
] as const;

export type ServiceSlug = (typeof SERVICES)[number]["slug"];

export const MATERIALS = [
  {
    name: "Composite",
    blurb: "Low maintenance, no staining, won't splinter. The most popular choice.",
  },
  {
    name: "Capped PVC",
    blurb: "Fully synthetic, the best moisture resistance. Great around pools.",
  },
  {
    name: "Pressure-Treated Wood",
    blurb: "The lowest upfront cost, with a classic wood look.",
  },
];

export type County = "Berks" | "Montgomery" | "Chester";

export const TOWNS: { slug: string; name: string; county: County }[] = [
  { slug: "douglassville", name: "Douglassville", county: "Berks" },
  { slug: "amity", name: "Amity", county: "Berks" },
  { slug: "exeter-township", name: "Exeter Township", county: "Berks" },
  { slug: "birdsboro", name: "Birdsboro", county: "Berks" },
  { slug: "union-township", name: "Union Township", county: "Berks" },
  { slug: "reading", name: "Reading", county: "Berks" },
  { slug: "limerick", name: "Limerick", county: "Montgomery" },
  { slug: "royersford", name: "Royersford", county: "Montgomery" },
  { slug: "collegeville", name: "Collegeville", county: "Montgomery" },
  { slug: "upper-providence-township", name: "Upper Providence Township", county: "Montgomery" },
  { slug: "pottstown", name: "Pottstown", county: "Montgomery" },
  { slug: "coventry", name: "Coventry", county: "Chester" },
  { slug: "west-chester", name: "West Chester", county: "Chester" },
];

export const findTown = (slug: string) => TOWNS.find((t) => t.slug === slug);

export const PROCESS_STEPS = [
  { title: "Free on-site estimate", body: "We come out, measure, and talks through what you want and what it'll cost." },
  { title: "Design & permits", body: "We finalize the plan and handle the permit application and township approval." },
  { title: "The build", body: "Our carpenters build your deck to the plan, with no sales team in the middle." },
  { title: "Inspection & walkthrough", body: "We schedule the final inspection and walk the finished deck with you." },
];

export const PERMIT_STEPS = [
  { title: "Requirements review", body: "We check zoning, setbacks, and code requirements for your property." },
  { title: "Permit application", body: "We prepare drawings and submit the permit application for you." },
  { title: "Township approval", body: "We work with the township until the permit is approved." },
  { title: "Inspections", body: "We schedule and meet the inspector for each required inspection." },
];
