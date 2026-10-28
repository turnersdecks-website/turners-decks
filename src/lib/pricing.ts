// Turner's Decks estimator — central pricing configuration + calculation engine.
// All dollar values are WORKING ASSUMPTIONS from the owner's pricing brief.
// Edit numbers here only; the estimator screen never hard-codes prices.
// Values marked "ASSUMPTION" were not in the brief and need owner confirmation.

export const CALCULATOR_VERSION = "2.0";
export const PRICING_VERSION = "2026-10-21";

export const PRICING = {
  minimumProjectPrice: 10000,
  markupPercent: 0, // applied to the subtotal before the minimum

  // $ per sq ft for the deck platform (midpoint is what the engine uses)
  materials: {
    pressureTreated: { newMid: 52, redeckMid: 30 },
    standardComposite: { newMid: 85, redeckMid: 36 },
    premiumComposite: { newMid: 95, redeckMid: 44 }, // redeck: ASSUMPTION
    pvc: { newMid: 105, redeckMid: 48 }, // redeck: ASSUMPTION
    specialtyWood: { newMid: 90, redeckMid: 42 }, // ASSUMPTION, always manual review
    unsure: { newMid: 85, redeckMid: 36 },
  },

  heightMultipliers: { ground: 1.0, low: 1.05, medium: 1.12, high: 1.2, multiple: 1.18, unsure: 1.05 },
  layoutMultipliers: { rectangle: 1.0, minor: 1.04, lShape: 1.08, wraparound: 1.12, multiPlatform: 1.15, multiLevel: 1.18, angled: 1.08, curved: 1.2, unsure: 1.05 },
  accessMultipliers: { open: 1.0, standard: 1.0, narrow: 1.04, handCarry: 1.08, steep: 1.1, townhouse: 1.04, throughHouse: 1.1, unsure: 1.02 },
  expansionIntegration: 0.08, // ASSUMPTION: +8% platform for tying into an existing deck
  redeckFramingContingency: 0.1, // planning allowance, % of redeck platform

  railingPerLf: { pressureTreated: 92, whiteVinyl: 135, allBlack: 160, composite: 185, aluminum: 160, premium: 225, unsure: 135 },
  // share of exposed edge that gets railing, by answer
  railingSideShare: { none: 0, one: 0.35, two: 0.65, three: 1, most: 0.9, unsure: 0.7 },
  stairOpeningLf: 4,

  stairs: {
    small: { base: 1500, risers: 2, railLfPerSide: 0 },
    standard: { base: 2500, risers: 5, railLfPerSide: 8 },
    medium: { base: 4250, risers: 8, railLfPerSide: 12 },
    tall: { base: 6750, risers: 13, railLfPerSide: 16 },
    switchback: { base: 9500, risers: 16, railLfPerSide: 24 },
    wrapped: { base: 2000, risers: 2, railLfPerSide: 0 },
    unsure: { base: 2500, risers: 5, railLfPerSide: 8 },
  },
  closedRiserPerRiser: 175,
  landing: { sqft: 16, structureFactor: 1.5, railLf: 8 },

  demolition: { none: 0, deckingOnly: 1300, deckingRailings: 2250, deckStairs: 3250, full: 3250, largeRestricted: 6000, homeowner: 0, unsure: 3250 },

  fasciaPerLf: { standard: 22.5, premium: 35 },
  // % added to the platform cost
  patternUpgrade: { standard: 0, contrasting: 0.02, double: 0.04, breaker: 0.03, diagonal: 0.075, herringbone: 0.15 },

  skirtingPerSqft: { none: 0, ptLattice: 30, vinylLattice: 42.5, horizontalWood: 55, composite: 77.5, unsure: 42.5 },
  skirtingAvgHeightFt: { ground: 1.5, low: 4, medium: 7, high: 10, multiple: 6, unsure: 4 },
  skirtingAccessDoor: 1000,

  privacyWallPerLf: 300,
  privacyWallLf: { none: 0, short: 6, full: 12, two: 24, screen: 8, unsure: 8 },
  gateEach: 1300,

  lighting: { none: 0, stairs: 900, postCaps: 1750, perimeter: 3000, package: 3500, custom: 4000, unsure: 1500 },

  // flat allowances; 0 = priced only at the site visit (manual review)
  features: {
    drinkRail: 1500, // ASSUMPTION
    bench: 1800, // ASSUMPTION
    planters: 900, // ASSUMPTION
    postWraps: 1950, // ~6 posts × $325
    concretePad: 1200, // ASSUMPTION
    storageAccess: 800, // ASSUMPTION
    drainage: 0,
    ceiling: 0,
    pergola: 0,
    roof: 0,
    hotTub: 0,
    kitchen: 0,
    outlets: 0,
    patioBelow: 0,
    poolConnection: 0,
  },

  permitAllowance: 1000,

  customerRange: {
    standard: [0.9, 1.1],
    uncertain: [0.85, 1.18],
    review: [0.8, 1.25],
  },

  // [PLACEHOLDER] ZIP prefixes — confirm the real 30-mile service area.
  serviceArea: {
    primaryZipPrefixes: ["193", "194", "195"],
    edgeZipPrefixes: ["175", "176", "180", "181", "189", "190", "191"],
  },

  // Internal only — never subtracted on the public estimator.
  neighborDiscounts: { one: 700, twoPlus: 1000 },
} as const;

type P = typeof PRICING;
export type Section = { width: number; depth: number };
export type YesNoUnsure = "yes" | "no" | "unsure";

export type EstimateInput = {
  projectType: "new" | "replacement" | "redeck" | "expansion";
  shape: "rectangle" | "lShape" | "wraparound" | "multiPlatform" | "pool" | "other";
  sections: Section[];
  attached: YesNoUnsure;
  height: keyof P["heightMultipliers"];
  layout: keyof P["layoutMultipliers"];
  slope: "flat" | "gentle" | "steep" | "unsure";
  access: keyof P["accessMultipliers"];
  townhouse: YesNoUnsure;
  zip: string;
  hoa: YesNoUnsure;
  historic: YesNoUnsure;
  material: keyof P["materials"];
  railingSides: keyof P["railingSideShare"];
  railingLf?: number | undefined;
  railingStyle: keyof P["railingPerLf"];
  gates: 0 | 1 | 2;
  privacyWall: keyof P["privacyWallLf"];
  stairType: "none" | keyof P["stairs"];
  stairCount: 1 | 2;
  stairRails: "one" | "both";
  closedRisers: boolean;
  landing: "none" | "top" | "mid" | "bottom" | "multiple" | "unsure";
  demolition: keyof P["demolition"];
  framingSound: YesNoUnsure;
  rot: YesNoUnsure;
  unstable: YesNoUnsure;
  fascia: keyof P["fasciaPerLf"];
  pattern: keyof P["patternUpgrade"];
  skirting: keyof P["skirtingPerSqft"];
  skirtingCoverage: "partial" | "full";
  skirtingDoor: boolean;
  lighting: keyof P["lighting"];
  features: (keyof P["features"])[];
  neighbors: "no" | "one" | "twoPlus" | "possibly";
};

export type ServiceArea = "primary" | "edge" | "outside" | "unknown";

export type EstimateResult = {
  sqft: number;
  railingLf: number;
  lineItems: { platform: number; railing: number; stairs: number; landing: number; demolition: number; fascia: number; pattern: number; skirting: number; gates: number; privacy: number; lighting: number; features: number; permit: number; framing: number };
  mid: number;
  low: number;
  high: number;
  belowMinimum: boolean;
  flags: string[];
  uncertain: boolean;
  serviceArea: ServiceArea;
};

export function serviceAreaFor(zip: string, cfg: P = PRICING): ServiceArea {
  if (!/^\d{5}$/.test(zip)) return "unknown";
  const pre = zip.slice(0, 3);
  if ((cfg.serviceArea.primaryZipPrefixes as readonly string[]).includes(pre)) return "primary";
  if ((cfg.serviceArea.edgeZipPrefixes as readonly string[]).includes(pre)) return "edge";
  return "outside";
}

/** Round: <$25k → $500, $25k–$75k → $1,000, >$75k → $2,500 */
export function roundEstimate(n: number): number {
  const step = n < 25000 ? 500 : n <= 75000 ? 1000 : 2500;
  return Math.round(n / step) * step;
}

export const totalSqft = (sections: Section[]) =>
  sections.reduce((s, x) => s + Math.max(0, x.width) * Math.max(0, x.depth), 0);

/** Exposed edge length: section perimeters, minus shared edges and the house wall. */
export function exposedPerimeter(i: Pick<EstimateInput, "sections" | "attached">): number {
  const secs = i.sections.filter((s) => s.width > 0 && s.depth > 0);
  if (!secs.length) return 0;
  let p = secs.reduce((s, x) => s + 2 * (x.width + x.depth), 0);
  for (const s of secs.slice(1)) p -= 2 * Math.min(s.width, s.depth); // joined to another section
  if (i.attached === "yes") p -= Math.max(...secs.map((s) => s.width));
  return Math.max(0, p);
}

export function estimateProject(i: EstimateInput, cfg: P = PRICING): EstimateResult {
  const flags: string[] = [];
  const flag = (cond: boolean, msg: string) => cond && flags.push(msg);
  const sqft = totalSqft(i.sections);
  const edge = exposedPerimeter(i);
  const redeck = i.projectType === "redeck";
  const mat = cfg.materials[i.material];
  const heightMult = cfg.heightMultipliers[i.height];

  // 1–4. Platform with structural multipliers
  const rate = redeck ? mat.redeckMid : mat.newMid;
  const hMult = redeck ? 1 + (heightMult - 1) / 2 : heightMult; // redeck reuses structure
  let platform = sqft * rate * hMult * cfg.layoutMultipliers[i.layout] * cfg.accessMultipliers[i.access];
  if (i.projectType === "expansion") platform *= 1 + cfg.expansionIntegration;

  // 5. Railings
  const hasStairs = i.stairType !== "none";
  const openings = hasStairs ? i.stairCount * cfg.stairOpeningLf : 0;
  const railingLf =
    i.railingSides === "none"
      ? 0
      : Math.max(0, Math.round(i.railingLf && i.railingLf > 0 ? i.railingLf : edge * cfg.railingSideShare[i.railingSides] - openings));
  const railRate = cfg.railingPerLf[i.railingStyle];
  const railing = railingLf * railRate;

  // 6–7. Stairs and landings
  let stairs = 0;
  let landing = 0;
  if (i.stairType !== "none") {
    const s = cfg.stairs[i.stairType];
    const per =
      s.base +
      s.railLfPerSide * (i.stairRails === "both" ? 2 : 1) * railRate +
      (i.closedRisers ? s.risers * cfg.closedRiserPerRiser : 0);
    stairs = per * i.stairCount;
    if (i.landing !== "none") {
      const n = i.landing === "multiple" ? 2 : 1;
      landing = n * (cfg.landing.sqft * mat.newMid * cfg.landing.structureFactor * heightMult + cfg.landing.railLf * railRate);
    }
  }

  // 8. Demolition (redeck always removes old boards; replacement always removes the old deck)
  let demolition: number = cfg.demolition[i.demolition];
  if (redeck && i.demolition !== "homeowner") demolition = Math.max(demolition, cfg.demolition.deckingOnly);
  if (i.projectType === "replacement" && i.demolition === "none") demolition = cfg.demolition.full;

  // 9. Fascia + patterns
  const fascia = edge * cfg.fasciaPerLf[i.fascia];
  const pattern = platform * cfg.patternUpgrade[i.pattern];

  // 10. Skirting
  let skirting = 0;
  if (i.skirting !== "none") {
    const lf = edge * (i.skirtingCoverage === "full" ? 1 : 0.5);
    skirting = lf * cfg.skirtingAvgHeightFt[i.height] * cfg.skirtingPerSqft[i.skirting] + (i.skirtingDoor ? cfg.skirtingAccessDoor : 0);
  }

  // 11–12. Gates, privacy, lighting, features
  const gates = i.gates * cfg.gateEach;
  const privacy = cfg.privacyWallLf[i.privacyWall] * cfg.privacyWallPerLf;
  const lighting = cfg.lighting[i.lighting];
  const features = i.features.reduce((s, f) => s + cfg.features[f], 0);

  // 13–14. Permit + redeck framing allowance
  const permit = cfg.permitAllowance;
  const framing = redeck ? platform * cfg.redeckFramingContingency : 0;

  const lineItems = { platform, railing, stairs, landing, demolition, fascia, pattern, skirting, gates, privacy, lighting, features, permit, framing };
  let mid = Object.values(lineItems).reduce((a, b) => a + b, 0) * (1 + cfg.markupPercent);

  // 17. Minimum
  const belowMinimum = mid < cfg.minimumProjectPrice;
  if (belowMinimum) mid = cfg.minimumProjectPrice;

  // Manual-review flags
  const serviceArea = serviceAreaFor(i.zip, cfg);
  flag(i.height === "high", "Deck more than 10 feet high");
  flag(i.height === "multiple" || i.layout === "multiLevel", "Multiple levels");
  flag(i.stairType === "switchback", "Switchback stairs");
  flag(i.features.includes("roof"), "Roof structure");
  flag(i.features.includes("pergola"), "Pergola");
  flag(i.features.includes("hotTub"), "Hot tub");
  flag(i.features.includes("kitchen"), "Outdoor kitchen");
  flag(i.features.includes("ceiling"), "Under-deck ceiling");
  flag(i.features.includes("poolConnection"), "Major pool integration");
  flag(i.features.includes("outlets") || i.lighting === "custom", "Custom electrical work");
  flag(i.layout === "curved", "Curved or highly custom deck");
  flag(i.pattern === "herringbone", "Extensive custom pattern");
  flag(i.material === "specialtyWood", "Specialty wood");
  flag(i.shape === "multiPlatform" || i.layout === "multiPlatform", "Multiple connected platforms");
  flag(i.slope === "steep" || i.access === "steep", "Significant slope");
  flag(i.access === "throughHouse", "Access through the house");
  flag(redeck && i.rot === "yes", "Visible rot in existing framing");
  flag(redeck && i.unstable === "yes", "Existing deck moves or feels unstable");
  flag(redeck && i.framingSound !== "yes", "Existing framing condition unknown");
  flag(i.historic === "yes", "Historic district");
  flag(i.townhouse === "yes" || i.access === "townhouse", "Townhouse or attached home");
  flag(i.hoa === "yes", "HOA approval may be required");
  flag(i.privacyWall === "screen", "Custom privacy screen");
  flag(i.shape === "other", "Custom project shape");
  flag(i.projectType === "expansion", "Expansion: tying into the existing deck");
  flag(serviceArea === "outside", "Outside the normal service area");

  const unsureCount = [
    i.attached, i.height, i.layout, i.slope, i.access, i.material, i.railingSides, i.railingStyle,
    i.stairType, i.landing, i.demolition, i.skirting, i.lighting, i.privacyWall,
  ].filter((v) => v === "unsure").length;
  const uncertain = unsureCount >= 2 || serviceArea === "unknown";

  const [lo, hi] = flags.length ? cfg.customerRange.review : uncertain ? cfg.customerRange.uncertain : cfg.customerRange.standard;
  const low = Math.max(roundEstimate(mid * lo), cfg.minimumProjectPrice);
  const high = roundEstimate(mid * hi);

  return { sqft, railingLf, lineItems, mid: Math.round(mid), low, high, belowMinimum, flags, uncertain, serviceArea };
}

export const formatUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
