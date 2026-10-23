// Server-side lead handling: validate, recompute estimator prices from the raw
// answers (never trust prices sent by the browser), and shape the database row.
import { leadSchema } from "./quote";
import { CALCULATOR_VERSION, PRICING_VERSION, estimateProject, type EstimateInput } from "./pricing";
import { labelFor, leadSummary } from "./estimator-questions";

export type LeadRow = {
  id: string;
  created_at: string;
  source: "quote_form" | "estimator";
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  zip: string;
  project_type: string | null;
  approx_size: string | null;
  material: string | null;
  height: string | null;
  railing: string | null;
  stairs: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
  estimate_mid: number | null;
  notes: string | null;
  answers: string | null;
  review_flags: string | null;
  calculator_version: string | null;
  pricing_version: string | null;
  address: string | null;
  contact_method: string | null;
  timing: string | null;
  wants_financing: number | null;
  lead_summary: string | null;
};

export type BuildResult =
  | { ok: true; row: LeadRow }
  | { ok: false; status: 400; errors: Record<string, string> }
  | { ok: false; status: 204; spam: true };

const n = <T>(v: T | undefined | "") => (v === undefined || v === "" ? null : v);

export function buildLeadRow(body: unknown, now = new Date(), id: string = crypto.randomUUID()): BuildResult {
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    // A filled honeypot is a bot: accept quietly so it doesn't retry.
    if (parsed.error.issues.some((i) => i.path[0] === "company")) return { ok: false, status: 204, spam: true };
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    return { ok: false, status: 400, errors };
  }
  const d = parsed.data;

  const row: LeadRow = {
    id,
    created_at: now.toISOString(),
    source: d.source,
    first_name: d.first_name,
    last_name: d.last_name,
    email: d.email,
    phone: d.phone,
    zip: d.zip,
    project_type: n(d.project_type),
    approx_size: n(d.approx_size),
    material: n(d.material),
    height: n(d.height),
    railing: n(d.railing),
    stairs: n(d.stairs),
    estimate_low: null,
    estimate_high: null,
    estimate_mid: null,
    notes: n(d.notes),
    answers: null,
    review_flags: null,
    calculator_version: null,
    pricing_version: null,
    address: n(d.address),
    contact_method: n(d.contact_method),
    timing: n(d.timing),
    wants_financing: d.wants_financing === undefined ? null : d.wants_financing ? 1 : 0,
    lead_summary: null,
  };

  if (d.source === "estimator") {
    if (!d.answers) return { ok: false, status: 400, errors: { answers: "Missing estimator answers" } };
    const a = { ...(d.answers as EstimateInput), zip: d.zip };
    let r;
    try {
      r = estimateProject(a);
    } catch {
      return { ok: false, status: 400, errors: { answers: "Estimator answers could not be priced" } };
    }
    if (!Number.isFinite(r.mid)) return { ok: false, status: 400, errors: { answers: "Estimator answers could not be priced" } };
    Object.assign(row, {
      project_type: labelFor("projectType", a.projectType),
      approx_size: `${r.sqft} sq ft`,
      material: labelFor("material", a.material),
      height: labelFor("height", a.height),
      railing: a.railingSides === "none" ? "None" : `${labelFor("railingStyle", a.railingStyle)}, ~${r.railingLf} ft`,
      stairs: labelFor("stairType", a.stairType),
      estimate_low: r.low,
      estimate_high: r.high,
      estimate_mid: r.mid,
      answers: JSON.stringify(a),
      review_flags: JSON.stringify(r.flags),
      calculator_version: CALCULATOR_VERSION,
      pricing_version: PRICING_VERSION,
      lead_summary: leadSummary(`${d.first_name} ${d.last_name}`, a, r, d.timing ?? "", d.notes ?? "").slice(0, 6000),
    });
  }
  return { ok: true, row };
}

/** Plain-text notification body for the owner. */
export function leadEmailText(row: LeadRow): string {
  if (row.lead_summary) return `${row.lead_summary}\n\nPhone: ${row.phone}\nEmail: ${row.email}\nPreferred contact: ${row.contact_method ?? "—"}\nAddress: ${row.address ?? "—"}\nWants financing info: ${row.wants_financing ? "Yes" : "No"}`;
  return [
    "New quote request from the website",
    `Customer: ${row.first_name} ${row.last_name}`,
    `Phone: ${row.phone}`,
    `Email: ${row.email}`,
    `ZIP: ${row.zip}`,
    `Project: ${row.project_type ?? "—"}`,
    `Approx. size: ${row.approx_size ?? "—"}`,
    `Material: ${row.material ?? "—"}`,
    `Notes: ${row.notes ?? "—"}`,
  ].join("\n");
}
