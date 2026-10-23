// Maps a website lead onto Pat's Airtable "Leads" table (base "Turner's Decks").
// Uses field IDs, so renaming a column in Airtable doesn't break the website.
// Select fields only get values that already exist as options; anything that
// doesn't map cleanly is left blank and still appears in "What they want".
import type { LeadRow } from "./lead";
import { formatUSD } from "./pricing";

export const AIRTABLE = {
  baseId: "appMKJ34ZOQDp2OJA",
  leadsTableId: "tblVnTat7d2X2t7QU",
  f: {
    name: "fldrDa5J57no8RyU5",
    phone: "fldw3Q1kYWaCvq3Vq",
    email: "fldABNcyJ5LxY9Asc",
    projectType: "fldbLtvoB55C3Aa1I",
    material: "fldbLTp9YbQiWkWqb",
    whatTheyWant: "fldpkvvW8YDXdAcGS",
    timeframe: "fldZQt94wRjbL5iAQ",
    stage: "fldlIZOsQI4oEMFuH",
    notes: "fldzYL6H3durQt7s9",
    squareFootage: "fldiGafGK4OZ5kV9r",
    streetAddress: "fldclDjZ5nqjsrv7t",
    leadDate: "fldJU8XFI440PiWAL",
  },
} as const;

type Answers = { projectType?: string; material?: string };

function projectType(row: LeadRow, a: Answers): string | undefined {
  const v = a.projectType ?? row.project_type;
  if (v === "new" || v === "New deck") return "New build";
  if (v === "replacement" || v === "redeck" || v === "Deck replacement") return "Rebuild or replacement";
  return undefined; // pool deck, expansion: could be either, so Pat sets it
}

function material(row: LeadRow, a: Answers): string | undefined {
  const v = a.material ?? row.material;
  if (v === "standardComposite" || v === "premiumComposite" || v === "Composite") return "Composite";
  if (v === "pressureTreated" || v === "Pressure-treated wood") return "Pressure-treated wood";
  if (v === "unsure" || v === "Not sure") return "Not sure yet";
  return undefined; // PVC, specialty wood: no matching option yet
}

const TIMEFRAME: Record<string, string> = {
  "As soon as possible": "ASAP",
  "Within 3 months": "1 to 3 months",
  "3–6 months": "3 to 6 months",
  "Just planning": "Just researching",
};

const prettyPhone = (p: string) => `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;

/** Lead date in Eastern time, YYYY-MM-DD. */
const easternDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export function airtableFields(row: LeadRow): Record<string, string | number> {
  const a: Answers = row.answers ? JSON.parse(row.answers) : {};
  const { f } = AIRTABLE;
  const want =
    row.source === "estimator"
      ? [
          `Website price estimator: ${formatUSD(row.estimate_low ?? 0)} to ${formatUSD(row.estimate_high ?? 0)}`,
          "",
          row.lead_summary ?? "",
        ].join("\n")
      : [
          "Website quote form",
          `Project: ${row.project_type ?? "—"}`,
          `Approx. size: ${row.approx_size ?? "—"}`,
          `Material: ${row.material ?? "—"}`,
          `ZIP: ${row.zip}`,
        ].join("\n");

  const notes = [
    row.notes,
    row.contact_method ? `Prefers: ${row.contact_method}` : null,
    row.wants_financing ? "Asked for financing info" : null,
  ].filter(Boolean).join("\n");

  const fields: Record<string, string | number | undefined> = {
    [f.name]: `${row.first_name} ${row.last_name}`,
    [f.phone]: prettyPhone(row.phone),
    [f.email]: row.email,
    [f.projectType]: projectType(row, a),
    [f.material]: material(row, a),
    [f.whatTheyWant]: want.trim(),
    [f.timeframe]: row.timing ? TIMEFRAME[row.timing] : undefined,
    [f.stage]: "New",
    [f.notes]: notes || undefined,
    [f.squareFootage]: row.source === "estimator" && row.approx_size ? parseInt(row.approx_size, 10) || undefined : undefined,
    [f.streetAddress]: row.address ?? undefined,
    [f.leadDate]: easternDate(row.created_at),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string | number>;
}

export async function sendToAirtable(token: string, row: LeadRow): Promise<string> {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE.baseId}/${AIRTABLE.leadsTableId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: airtableFields(row) }] }),
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { records: { id: string }[] };
  return data.records[0]!.id;
}
