import { describe, expect, it } from "vitest";
import { buildLeadRow } from "./lead";
import { estimateProject, type EstimateInput } from "./pricing";

const contact = { first_name: "Jane", last_name: "Doe", email: "jane@example.com", phone: "(610) 555-0123", zip: "19518" };

const answers: EstimateInput = {
  projectType: "replacement", shape: "rectangle", sections: [{ width: 20, depth: 16 }], attached: "yes",
  height: "low", layout: "rectangle", slope: "flat", access: "standard", townhouse: "no", zip: "19518",
  hoa: "no", historic: "no", material: "standardComposite", railingSides: "three", railingLf: 35,
  railingStyle: "whiteVinyl", gates: 0, privacyWall: "none", stairType: "standard", stairCount: 1,
  stairRails: "one", closedRisers: false, landing: "none", demolition: "full", framingSound: "yes",
  rot: "no", unstable: "no", fascia: "standard", pattern: "standard", skirting: "none",
  skirtingCoverage: "full", skirtingDoor: false, lighting: "none", features: [], neighbors: "no",
};

describe("lead handling", () => {
  it("accepts a quote-form lead and normalizes the phone", () => {
    const r = buildLeadRow({ source: "quote_form", ...contact, project_type: "New deck", company: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.phone).toBe("6105550123");
      expect(r.row.estimate_mid).toBeNull();
    }
  });

  it("rejects bad contact details with field messages", () => {
    const r = buildLeadRow({ source: "quote_form", ...contact, email: "nope", zip: "123" });
    expect(r.ok).toBe(false);
    if (!r.ok && "errors" in r) expect(Object.keys(r.errors).sort()).toEqual(["email", "zip"]);
  });

  it("drops honeypot submissions quietly", () => {
    const r = buildLeadRow({ source: "quote_form", ...contact, company: "Spam LLC" });
    expect(r).toMatchObject({ ok: false, spam: true });
  });

  it("recomputes estimator prices on the server and ignores prices sent by the browser", () => {
    const r = buildLeadRow({ source: "estimator", ...contact, answers, estimate_low: 1, estimate_high: 2, estimate_mid: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const expected = estimateProject(answers);
      expect([r.row.estimate_low, r.row.estimate_high, r.row.estimate_mid]).toEqual([expected.low, expected.high, expected.mid]);
      expect(r.row.lead_summary).toContain("Customer: Jane Doe");
      expect(JSON.parse(r.row.review_flags!)).toEqual([]);
    }
  });

  it("requires answers for estimator leads", () => {
    expect(buildLeadRow({ source: "estimator", ...contact }).ok).toBe(false);
  });
});

import { airtableFields, AIRTABLE } from "./airtable";

describe("Airtable mapping", () => {
  const f = AIRTABLE.f;
  it("maps an estimator lead onto existing select options", () => {
    const r = buildLeadRow({ source: "estimator", ...contact, timing: "Within 3 months", address: "1 Main St", answers }, new Date("2026-10-23T03:00:00Z"));
    if (!r.ok) throw new Error("expected ok");
    const x = airtableFields(r.row);
    expect(x[f.name]).toBe("Jane Doe");
    expect(x[f.phone]).toBe("(610) 555-0123");
    expect(x[f.projectType]).toBe("Rebuild or replacement");
    expect(x[f.material]).toBe("Composite");
    expect(x[f.timeframe]).toBe("1 to 3 months");
    expect(x[f.stage]).toBe("New");
    expect(x[f.squareFootage]).toBe(320);
    expect(x[f.leadDate]).toBe("2026-10-22"); // Eastern time, not UTC
    expect(String(x[f.whatTheyWant])).toMatch(/^Website price estimator: \$\d/);
  });

  it("leaves selects blank when the answer has no matching option", () => {
    const r = buildLeadRow({ source: "quote_form", ...contact, project_type: "Pool deck", material: "Capped PVC" });
    if (!r.ok) throw new Error("expected ok");
    const x = airtableFields(r.row);
    expect(x[f.projectType]).toBeUndefined();
    expect(x[f.material]).toBeUndefined();
    expect(String(x[f.whatTheyWant])).toContain("Pool deck");
  });
});
