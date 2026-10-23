// Customer-facing wording for every estimator question. Edit labels here;
// pricing lives in pricing.ts.
import type { EstimateInput, EstimateResult } from "./pricing";
import { formatUSD } from "./pricing";

export type Opt = { value: string; label: string; hint?: string };
type Opts = Partial<Record<keyof EstimateInput, Opt[]>>;
const yn: Opt[] = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "Not sure" }];

export const OPTIONS: Opts = {
  projectType: [
    { value: "new", label: "New deck", hint: "New footings, framing, decking, and railings" },
    { value: "replacement", label: "Full deck replacement", hint: "We tear out the old deck and build new" },
    { value: "redeck", label: "Redeck on existing framing", hint: "New boards and railings on a sound frame" },
    { value: "expansion", label: "Expand an existing deck", hint: "Add onto a deck you're keeping" },
  ],
  shape: [
    { value: "rectangle", label: "Rectangle" },
    { value: "lShape", label: "L-shape" },
    { value: "wraparound", label: "Wraparound" },
    { value: "multiPlatform", label: "Multiple platforms" },
    { value: "pool", label: "Pool deck" },
    { value: "other", label: "Other / not sure" },
  ],
  attached: yn,
  height: [
    { value: "ground", label: "Ground level", hint: "Under 30 inches" },
    { value: "low", label: "30 in to 6 ft" },
    { value: "medium", label: "6 to 10 ft" },
    { value: "high", label: "More than 10 ft" },
    { value: "multiple", label: "Multiple levels" },
    { value: "unsure", label: "Not sure" },
  ],
  layout: [
    { value: "rectangle", label: "Simple rectangle" },
    { value: "minor", label: "Rectangle with a small bump-out" },
    { value: "lShape", label: "L-shaped" },
    { value: "wraparound", label: "Wraparound" },
    { value: "multiPlatform", label: "Multiple platforms" },
    { value: "multiLevel", label: "Multi-level" },
    { value: "angled", label: "Angled or diagonal" },
    { value: "curved", label: "Curved or highly custom" },
    { value: "unsure", label: "Not sure" },
  ],
  slope: [
    { value: "flat", label: "Flat" },
    { value: "gentle", label: "Gentle slope" },
    { value: "steep", label: "Steep" },
    { value: "unsure", label: "Not sure" },
  ],
  access: [
    { value: "open", label: "Wide, open access" },
    { value: "standard", label: "Standard backyard access" },
    { value: "narrow", label: "Narrow gate or tight side yard" },
    { value: "handCarry", label: "Materials must be hand-carried" },
    { value: "steep", label: "Steep yard" },
    { value: "townhouse", label: "Townhouse / attached home" },
    { value: "throughHouse", label: "Only through the house" },
    { value: "unsure", label: "Not sure" },
  ],
  townhouse: yn.slice(0, 2),
  hoa: yn,
  historic: yn,
  material: [
    { value: "pressureTreated", label: "Pressure-treated wood", hint: "Most affordable. Needs cleaning and sealing over time." },
    { value: "standardComposite", label: "Standard composite", hint: "Low maintenance, lots of colors (Trex Select class)." },
    { value: "premiumComposite", label: "Premium composite", hint: "Richer look and texture, better warranties, cooler options." },
    { value: "pvc", label: "PVC decking", hint: "Top moisture resistance, lighter weight, high-end." },
    { value: "specialtyWood", label: "Specialty wood", hint: "Cedar, mahogany, and similar. Priced after a visit." },
    { value: "unsure", label: "Not sure yet" },
  ],
  railingSides: [
    { value: "none", label: "No railings" },
    { value: "one", label: "One side" },
    { value: "two", label: "Two sides" },
    { value: "three", label: "Three sides" },
    { value: "most", label: "Around most of the deck" },
    { value: "unsure", label: "Not sure" },
  ],
  railingStyle: [
    { value: "pressureTreated", label: "Pressure-treated wood" },
    { value: "whiteVinyl", label: "White vinyl, black balusters" },
    { value: "allBlack", label: "All-black railing" },
    { value: "composite", label: "Composite railing" },
    { value: "aluminum", label: "Aluminum" },
    { value: "premium", label: "Premium or custom" },
    { value: "unsure", label: "Not sure" },
  ],
  privacyWall: [
    { value: "none", label: "No" },
    { value: "short", label: "One short section" },
    { value: "full", label: "One full-height wall" },
    { value: "two", label: "Walls on two sides" },
    { value: "screen", label: "Decorative screen" },
    { value: "unsure", label: "Not sure" },
  ],
  stairType: [
    { value: "none", label: "No stairs" },
    { value: "small", label: "1–3 steps down" },
    { value: "standard", label: "Standard staircase", hint: "About 4–6 steps" },
    { value: "medium", label: "Medium staircase", hint: "About 7–10 steps" },
    { value: "tall", label: "Tall staircase", hint: "About 11–15 steps" },
    { value: "switchback", label: "Switchback with landing", hint: "Turns partway down" },
    { value: "wrapped", label: "Wide or wrapped steps" },
    { value: "unsure", label: "Not sure" },
  ],
  landing: [
    { value: "none", label: "No landing" },
    { value: "top", label: "Small top landing" },
    { value: "mid", label: "Mid-stair landing" },
    { value: "bottom", label: "Bottom landing" },
    { value: "multiple", label: "More than one" },
    { value: "unsure", label: "Not sure" },
  ],
  demolition: [
    { value: "none", label: "No existing deck" },
    { value: "deckingOnly", label: "Remove decking only" },
    { value: "deckingRailings", label: "Decking and railings" },
    { value: "deckStairs", label: "Deck and stairs" },
    { value: "full", label: "Full deck structure" },
    { value: "largeRestricted", label: "Large, tall, or hard-to-reach deck" },
    { value: "homeowner", label: "I'll remove it myself" },
    { value: "unsure", label: "Not sure" },
  ],
  framingSound: yn,
  rot: yn,
  unstable: yn,
  fascia: [
    { value: "standard", label: "Standard fascia" },
    { value: "premium", label: "Matching or white composite fascia" },
  ],
  pattern: [
    { value: "standard", label: "Standard (one picture-frame border)" },
    { value: "contrasting", label: "Contrasting-color border" },
    { value: "double", label: "Double picture frame" },
    { value: "breaker", label: "Breaker boards" },
    { value: "diagonal", label: "Diagonal decking" },
    { value: "herringbone", label: "Herringbone or custom pattern" },
  ],
  skirting: [
    { value: "none", label: "No skirting" },
    { value: "ptLattice", label: "Wood lattice" },
    { value: "vinylLattice", label: "White vinyl lattice" },
    { value: "horizontalWood", label: "Horizontal wood boards" },
    { value: "composite", label: "Composite skirting" },
    { value: "unsure", label: "Not sure" },
  ],
  skirtingCoverage: [
    { value: "partial", label: "Partial" },
    { value: "full", label: "Full perimeter" },
  ],
  lighting: [
    { value: "none", label: "No lighting" },
    { value: "stairs", label: "Stair lights" },
    { value: "postCaps", label: "Post-cap lights" },
    { value: "perimeter", label: "Perimeter lights" },
    { value: "package", label: "Stair + perimeter package" },
    { value: "custom", label: "Full custom lighting" },
    { value: "unsure", label: "Not sure" },
  ],
  features: [
    { value: "drinkRail", label: "Drink rail" },
    { value: "bench", label: "Built-in bench" },
    { value: "planters", label: "Planter boxes" },
    { value: "postWraps", label: "Decorative post wraps" },
    { value: "storageAccess", label: "Storage access" },
    { value: "concretePad", label: "Concrete landing pad" },
    { value: "drainage", label: "Under-deck drainage" },
    { value: "ceiling", label: "Under-deck ceiling" },
    { value: "patioBelow", label: "Patio below deck" },
    { value: "pergola", label: "Pergola" },
    { value: "roof", label: "Roof structure" },
    { value: "hotTub", label: "Hot tub" },
    { value: "kitchen", label: "Outdoor kitchen area" },
    { value: "outlets", label: "Extra electrical outlets" },
    { value: "poolConnection", label: "Connect to a pool" },
  ],
  neighbors: [
    { value: "no", label: "No" },
    { value: "one", label: "One neighbor" },
    { value: "twoPlus", label: "Two or more" },
    { value: "possibly", label: "Possibly / not sure" },
  ],
};

export const labelFor = (k: keyof EstimateInput, v: unknown) =>
  OPTIONS[k]?.find((o) => o.value === String(v))?.label ?? String(v ?? "");

export function projectSummary(i: EstimateInput, r: EstimateResult): [string, string][] {
  const stairs = i.stairType === "none" ? "No stairs" : `${i.stairCount} × ${labelFor("stairType", i.stairType)}${i.landing !== "none" ? `, ${labelFor("landing", i.landing).toLowerCase()}` : ""}`;
  return [
    ["Project", labelFor("projectType", i.projectType)],
    ["Size", `About ${r.sqft} sq ft (${i.sections.map((s) => `${s.width}×${s.depth}`).join(" + ")})`],
    ["Shape", labelFor("shape", i.shape)],
    ["Material", labelFor("material", i.material)],
    ["Height", labelFor("height", i.height)],
    ["Railing", i.railingSides === "none" ? "None" : `${labelFor("railingStyle", i.railingStyle)}, about ${r.railingLf} ft`],
    ["Stairs", stairs],
    ["Existing deck", labelFor("demolition", i.demolition)],
    ["Skirting", labelFor("skirting", i.skirting)],
    ["Lighting & extras", [labelFor("lighting", i.lighting), ...i.features.map((f) => labelFor("features", f))].join(", ")],
    ["ZIP", i.zip],
  ];
}

export function leadSummary(name: string, i: EstimateInput, r: EstimateResult, timing: string, notes: string) {
  return [
    "New deck estimate submission",
    `Customer: ${name}`,
    ...projectSummary(i, r).map(([k, v]) => `${k}: ${v}`),
    `Desired timing: ${timing || "—"}`,
    `Displayed range: ${formatUSD(r.low)} to ${formatUSD(r.high)} (internal midpoint ${formatUSD(r.mid)})`,
    `Manual review flags: ${r.flags.length ? r.flags.join("; ") : "None"}`,
    `Neighbors interested: ${labelFor("neighbors", i.neighbors)}`,
    `Customer notes: ${notes || "—"}`,
  ].join("\n");
}

export const DISCLAIMERS = {
  primary:
    "This online estimate is intended for early budgeting and planning only. It is not a formal proposal, contract, or guarantee of price. Final pricing depends on site measurements, structural requirements, access, township and permit requirements, material selections, existing conditions, and the final approved design.",
  redeck:
    "Redeck pricing assumes the existing footings, ledger, posts, beams, joists, stairs, and related framing are structurally sound, properly sized, code-compliant, and suitable for reuse. Repairs or upgrades identified after removal of the existing decking are not included unless specifically stated.",
  permit:
    "Permit fees and municipal requirements vary by township. The estimate includes a standard planning allowance unless otherwise noted. Engineering, zoning relief, variances, surveys, or unusual municipal requirements may require additional pricing.",
  material:
    "Material pricing can vary by manufacturer, product line, color, availability, and market conditions. Final material selections are confirmed before a formal proposal is issued.",
  homeownerDemo:
    "If you remove the existing deck yourself, the site must be fully cleared, safe, and ready before construction begins.",
  lighting:
    "Electrical upgrades, new circuits, transformer locations, outlets, and related house wiring may require separate pricing.",
  neighbors:
    "Neighboring projects may qualify for shared-mobilization savings. Final eligibility is confirmed during the proposal process.",
};

export const INCLUDED = [
  "Standard footings and framing",
  "Your selected decking material and standard fastening",
  "One picture-frame border on composite decks",
  "Selected railings, stairs, and landings",
  "Standard fascia",
  "Demolition and disposal, if selected",
  "Standard permit allowance",
  "General jobsite cleanup",
];

export const PRICE_FACTORS = [
  "Existing framing condition",
  "Footing and soil requirements",
  "Township and HOA requirements",
  "Final railing measurements and stair layout",
  "Property access",
  "Material colors and product lines",
  "Structural engineering",
  "Utility conflicts or hidden damage",
  "Final design selections",
];
