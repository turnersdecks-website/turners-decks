import { describe, expect, it } from "vitest";
import { buildSubmission } from "./lead";
import { estimateProject, formatUSD, type EstimateInput } from "./pricing";

const KEY = "test-key";
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

describe("Web3Forms submission", () => {
  it("builds a quote-form email with reply-to set to the customer", () => {
    const r = buildSubmission({ source: "quote_form", ...contact, project_type: "Pool deck", company: "" }, KEY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toMatchObject({
      access_key: KEY,
      email: "jane@example.com",
      Name: "Jane Doe",
      Phone: "(610) 555-0123",
      "Project type": "Pool deck",
      subject: "New quote request: Jane Doe (19518)",
    });
    expect(r.payload).not.toHaveProperty("Notes"); // blank fields are left out
  });

  it("rejects bad contact details with field messages", () => {
    const r = buildSubmission({ source: "quote_form", ...contact, email: "nope", zip: "123" }, KEY);
    expect(r.ok).toBe(false);
    if (!r.ok && "errors" in r) expect(Object.keys(r.errors).sort()).toEqual(["email", "zip"]);
  });

  it("drops honeypot submissions without sending", () => {
    expect(buildSubmission({ source: "quote_form", ...contact, company: "Spam LLC" }, KEY)).toEqual({ ok: false, spam: true });
  });

  it("computes the estimate from the answers, not from anything sent in", () => {
    const r = buildSubmission({ source: "estimator", ...contact, timing: "Within 3 months", answers, ...({ estimate_low: 1 } as object) }, KEY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = estimateProject(answers);
    const range = `${formatUSD(e.low)} to ${formatUSD(e.high)}`;
    expect(r.payload["Estimate shown"]).toBe(range);
    expect(r.payload.subject).toBe(`New estimator lead: Jane Doe, ${range}`);
    expect(r.payload["Size"]).toBe("320 sq ft");
    expect(r.payload["Full summary"]).toContain("Customer: Jane Doe");
    expect(r.payload).not.toHaveProperty("estimate_low");
  });

  it("requires answers for estimator leads", () => {
    expect(buildSubmission({ source: "estimator", ...contact }, KEY).ok).toBe(false);
  });
});
