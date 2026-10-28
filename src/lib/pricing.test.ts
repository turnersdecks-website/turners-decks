import { describe, expect, it } from "vitest";
import { estimateProject, roundEstimate, serviceAreaFor, type EstimateInput } from "./pricing";

const base: EstimateInput = {
  projectType: "replacement", shape: "rectangle", sections: [{ width: 20, depth: 16 }], attached: "yes",
  height: "low", layout: "rectangle", slope: "flat", access: "standard", townhouse: "no", zip: "19518",
  hoa: "no", historic: "no", material: "standardComposite", railingSides: "three", railingLf: 35,
  railingStyle: "whiteVinyl", gates: 0, privacyWall: "none", stairType: "standard", stairCount: 1,
  stairRails: "one", closedRisers: false, landing: "none", demolition: "full", framingSound: "yes",
  rot: "no", unstable: "no", fascia: "standard", pattern: "standard", skirting: "none",
  skirtingCoverage: "full", skirtingDoor: false, lighting: "none", features: [], neighbors: "no",
};

describe("deck estimator", () => {
  it("prices the brief's 320 sq ft composite replacement at $38,000–$47,000", () => {
    const r = estimateProject(base);
    expect(r.sqft).toBe(320);
    expect(r.mid).toBe(42285);
    expect([r.low, r.high]).toEqual([38000, 47000]);
    expect(r.flags).toEqual([]);
  });

  it("never shows less than the $10,000 minimum", () => {
    const r = estimateProject({ ...base, projectType: "new", sections: [{ width: 8, depth: 8 }], material: "pressureTreated", height: "ground", railingSides: "none", stairType: "none", demolition: "none" });
    expect(r.belowMinimum).toBe(true);
    expect(r.low).toBe(10000);
  });

  it("never shows a low end under the minimum, even just above it", () => {
    const r = estimateProject({ ...base, projectType: "new", sections: [{ width: 10, depth: 10 }], material: "pressureTreated", height: "ground", railingSides: "none", stairType: "none", demolition: "none", lighting: "stairs", features: ["drinkRail", "bench"] });
    expect(r.belowMinimum).toBe(false);
    expect(r.mid * 0.9).toBeLessThan(10000);
    expect(r.low).toBe(10000);
  });

  it("always prices removal on a full replacement", () => {
    expect(estimateProject({ ...base, demolition: "none" }).lineItems.demolition).toBe(3250);
  });

  it("flags townhouses and HOA properties for site review", () => {
    expect(estimateProject({ ...base, townhouse: "yes" }).flags).toContain("Townhouse or attached home");
    expect(estimateProject({ ...base, access: "townhouse" }).flags).toContain("Townhouse or attached home");
    expect(estimateProject({ ...base, hoa: "yes" }).flags).toContain("HOA approval may be required");
  });

  it("drops demolition when the homeowner removes the old deck", () => {
    expect(estimateProject({ ...base, demolition: "homeowner" }).lineItems.demolition).toBe(0);
  });

  it("adds no stair, stair-railing or landing cost without stairs", () => {
    const r = estimateProject({ ...base, stairType: "none", landing: "top" });
    expect(r.lineItems.stairs).toBe(0);
    expect(r.lineItems.landing).toBe(0);
  });

  it("adds a 10% framing allowance on redecks", () => {
    const r = estimateProject({ ...base, projectType: "redeck" });
    expect(r.lineItems.framing).toBeCloseTo(r.lineItems.platform * 0.1);
  });

  it("flags decks over 10 ft for manual review and widens the range to 80–125%", () => {
    const r = estimateProject({ ...base, height: "high" });
    expect(r.flags).toContain("Deck more than 10 feet high");
    expect(r.low).toBe(roundEstimate(r.mid * 0.8));
    expect(r.high).toBe(roundEstimate(r.mid * 1.25));
  });

  it("rounds to $500 under $25k, $1,000 to $75k, $2,500 above", () => {
    expect(roundEstimate(18240)).toBe(18000);
    expect(roundEstimate(38600)).toBe(39000);
    expect(roundEstimate(81000)).toBe(80000);
  });

  it("recognizes service-area ZIPs", () => {
    expect(serviceAreaFor("19518")).toBe("primary");
    expect(serviceAreaFor("10001")).toBe("outside");
  });
});
