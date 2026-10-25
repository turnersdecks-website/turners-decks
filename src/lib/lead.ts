// Turns a validated website lead into the Web3Forms submission that emails it
// to Turner's Decks. Pure function (no network) so it's easy to test.
import { leadSchema, type Lead } from "./quote";
import { estimateProject, formatUSD, type EstimateInput } from "./pricing";
import { labelFor, leadSummary } from "./estimator-questions";
import { SITE } from "./site";

export type Submission = Record<string, string>;

export type BuildResult =
  | { ok: true; payload: Submission }
  | { ok: false; spam: true }
  | { ok: false; errors: Record<string, string> };

const CONTACT_METHOD: Record<string, string> = { phone: "Phone call", text: "Text", email: "Email" };

const prettyPhone = (p: string) => `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;

/** Drops empty values so the email only shows answered fields. */
const compact = (o: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Submission;

export function buildSubmission(input: Lead, accessKey: string = SITE.web3formsKey): BuildResult {
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    // A filled honeypot means a bot: pretend it worked and send nothing.
    if (parsed.error.issues.some((i) => i.path[0] === "company")) return { ok: false, spam: true };
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    return { ok: false, errors };
  }
  const d = parsed.data;
  const name = `${d.first_name} ${d.last_name}`;

  // Web3Forms fields: `email` becomes the reply-to, so Pat can just hit Reply.
  const base = {
    access_key: accessKey,
    from_name: `${SITE.name} website`,
    email: d.email,
    Name: name,
    Phone: prettyPhone(d.phone),
    ZIP: d.zip,
  };

  if (d.source === "quote_form") {
    return {
      ok: true,
      payload: compact({
        ...base,
        subject: `New quote request: ${name} (${d.zip})`,
        "Form": "Free estimate request",
        "Project type": d.project_type,
        "Approx. size": d.approx_size,
        "Preferred material": d.material,
        "Notes": d.notes,
      }),
    };
  }

  if (!d.answers) return { ok: false, errors: { answers: "Missing estimator answers" } };
  const a = { ...(d.answers as EstimateInput), zip: d.zip };
  const r = estimateProject(a);
  const range = `${formatUSD(r.low)} to ${formatUSD(r.high)}`;
  return {
    ok: true,
    payload: compact({
      ...base,
      subject: `New estimator lead: ${name}, ${range}`,
      "Form": "Price estimator",
      "Estimate shown": range,
      "Project type": labelFor("projectType", a.projectType),
      "Size": `${r.sqft} sq ft`,
      "Material": labelFor("material", a.material),
      "Needs site review": r.flags.length ? r.flags.join("; ") : "No",
      "Timing": d.timing,
      "Best way to reach": d.contact_method && CONTACT_METHOD[d.contact_method],
      "Project address": d.address,
      "Wants financing info": d.wants_financing ? "Yes" : "No",
      "Notes": d.notes,
      "Full summary": leadSummary(name, a, r, d.timing ?? "", d.notes ?? ""),
    }),
  };
}

export const WEB3FORMS_URL = "https://api.web3forms.com/submit";
