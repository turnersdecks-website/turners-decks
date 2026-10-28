import { describe, expect, it } from "vitest";
import { answerError, filterAnswers, holds, parsePublicResult, serviceAreaFor, shown, totalSqft, visibleItems, visibleKeys, type PublicEstimator, type PublicQuestion } from "./estimator-public";

const choice = (key: string, values: string[], extra: Partial<PublicQuestion> = {}): PublicQuestion => ({
  key, kind: "choice", label: key, default: null, optional: false, options: values.map((v) => ({ value: v, label: v.toUpperCase() })), ...extra,
});

// A cut-down version shaped like the CRM's: railingStyle is asked on the Railings step, or on the Stairs step when
// there are no deck railings.
const est: PublicEstimator = {
  version: 3,
  steps: [
    { title: "Railings", items: [{ key: "railingSides" }, { key: "railingLf", showIf: [{ question: "railingSides", notIn: ["none"] }] }, { key: "railingStyle", showIf: [{ question: "railingSides", notIn: ["none"] }] }] },
    { title: "Stairs", items: [{ key: "stairType" }, { key: "railingStyle", showIf: [{ question: "railingSides", in: ["none"] }, { question: "stairType", notIn: ["none"] }] }] },
  ],
  questions: {
    railingSides: choice("railingSides", ["none", "three"]),
    railingLf: { key: "railingLf", kind: "number", label: "Length", default: null, optional: true },
    railingStyle: choice("railingStyle", ["whiteVinyl", "aluminum"], { default: "whiteVinyl" }),
    stairType: choice("stairType", ["none", "standard"]),
    sections: { key: "sections", kind: "sections", label: "Size", default: null, optional: false },
    zip: { key: "zip", kind: "zip", label: "ZIP", default: null, optional: false },
    features: { key: "features", kind: "multi", label: "Extras", default: null, optional: true, options: [{ value: "bench", label: "Bench" }, { value: "planters", label: "Planters" }] },
    closedRisers: { key: "closedRisers", kind: "toggle", label: "Risers", default: null, optional: true },
  },
  serviceArea: { primaryZipPrefixes: ["195"], edgeZipPrefixes: ["175"] },
  copy: {
    steps: ["Railings", "Stairs", "Your estimate"], intro: "", serviceArea: { primary: "", edge: "", outside: "" },
    disclaimers: { primary: "", redeck: "", permit: "", material: "", homeownerDemo: "", lighting: "", neighbors: "", townhouseHoa: "" },
    included: [], priceFactors: [],
  },
};

describe("relevance", () => {
  it("in / notIn hold only for an answered question", () => {
    expect(holds({ question: "stairType", notIn: ["none"] }, {})).toBe(false);
    expect(holds({ question: "stairType", notIn: ["none"] }, { stairType: "standard" })).toBe(true);
    expect(holds({ question: "stairType", notIn: ["none"] }, { stairType: "none" })).toBe(false);
    expect(holds({ question: "stairType", in: ["none"] }, { stairType: "none" })).toBe(true);
    expect(holds({ question: "stairType", in: ["none"] }, { stairType: "standard" })).toBe(false);
  });

  it("every condition must hold", () => {
    const item = est.steps[1]!.items[1]!;
    expect(shown(item, { railingSides: "none" })).toBe(false);
    expect(shown(item, { railingSides: "none", stairType: "standard" })).toBe(true);
    expect(shown({ key: "x" }, {})).toBe(true);
  });

  it("asks the railing style on the step that applies, once", () => {
    expect(visibleItems(est, 0, {}).map((i) => i.key)).toEqual(["railingSides"]);
    expect(visibleItems(est, 0, { railingSides: "three" }).map((i) => i.key)).toEqual(["railingSides", "railingLf", "railingStyle"]);
    expect(visibleKeys(est, { railingSides: "none", stairType: "standard" })).toEqual(["railingSides", "stairType", "railingStyle"]);
    expect(visibleKeys(est, { railingSides: "three", stairType: "standard" })).toEqual(["railingSides", "railingLf", "railingStyle", "stairType"]);
  });
});

describe("answer checks", () => {
  const q = est.questions;
  it("matches the CRM's limits", () => {
    expect(answerError(q.railingSides!, undefined)).toMatch(/Choose/);
    expect(answerError(q.railingSides!, "gold")).toMatch(/Choose/);
    expect(answerError(q.railingSides!, "three")).toBeNull();
    expect(answerError(q.sections!, [{ width: 20, depth: 16 }])).toBeNull();
    expect(answerError(q.sections!, [{ width: 2, depth: 16 }])).toMatch(/3 to 100/);
    expect(answerError(q.sections!, Array(6).fill({ width: 10, depth: 10 }))).toMatch(/3 to 100/);
    expect(answerError(q.zip!, "1951")).toMatch(/5-digit/);
    expect(answerError(q.railingLf!, undefined)).toBeNull();
    expect(answerError(q.railingLf!, 0)).toMatch(/1 and 1,000/);
    expect(answerError(q.features!, ["bench", "bench"])).toMatch(/listed/);
    expect(answerError(q.closedRisers!, true)).toBeNull();
  });

  it("restored answers keep only what fits the loaded version", () => {
    expect(
      filterAnswers(est, {
        railingSides: "three", railingStyle: "glass", stairType: 2, gone: "x", features: ["bench", "hotTub", "bench"],
        sections: [{ width: 20, depth: 16 }], zip: "19518", railingLf: 40, closedRisers: "yes",
      }),
    ).toEqual({ railingSides: "three", features: ["bench"], sections: [{ width: 20, depth: 16 }], zip: "19518", railingLf: 40 });
    expect(filterAnswers(est, "nonsense")).toEqual({});
    expect(filterAnswers(est, { sections: [{ width: "a" }] })).toEqual({});
  });

  it("square feet and service area are plain arithmetic and lookups", () => {
    expect(totalSqft([{ width: 20, depth: 16 }, { width: 5, depth: 0 }, { width: 5, depth: 29 }])).toBe(465);
    expect(serviceAreaFor(est, "19518")).toBe("primary");
    expect(serviceAreaFor(est, "17502")).toBe("edge");
    expect(serviceAreaFor(est, "10001")).toBe("outside");
  });
});

describe("parsePublicResult", () => {
  const r = { version: 1, low: 38000, high: 47000, belowMinimum: false, needsReview: true, sqft: 320, railingLf: 35, serviceArea: "edge" };
  it("accepts the CRM's result and nothing else", () => {
    expect(parsePublicResult(r)).toEqual(r);
    expect(parsePublicResult({ ...r, extra: 1 })).toEqual(r);
    expect(parsePublicResult({ ...r, low: 0 })).toBeNull();
    expect(parsePublicResult({ ...r, high: 1 })).toBeNull();
    expect(parsePublicResult({ ...r, serviceArea: "moon" })).toBeNull();
    expect(parsePublicResult({ ...r, needsReview: "yes" })).toBeNull();
    expect(parsePublicResult(null)).toBeNull();
  });
});
