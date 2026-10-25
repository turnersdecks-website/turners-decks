// Lead validation for the quote form and the estimator, plus the submit call.
import { z } from "zod";

const phone = z
  .string()
  .transform((v) => v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""))
  .refine((v) => /^\d{10}$/.test(v), "Enter a 10-digit phone number");

export const contactSchema = z.object({
  first_name: z.string().trim().min(1, "Enter your first name").max(60),
  last_name: z.string().trim().min(1, "Enter your last name").max(60),
  email: z.string().trim().email("Enter a valid email").max(255),
  phone,
  zip: z.string().trim().regex(/^\d{5}$/, "Enter a 5-digit zip code"),
});

export const quoteSchema = contactSchema.extend({
  project_type: z.enum(["New deck", "Deck replacement", "Pool deck"], { message: "Choose a project type" }),
  approx_size: z.string().trim().max(60).optional(),
  material: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const opt = (max: number) => z.string().trim().max(max).optional();

/** Everything a lead can carry. Estimator prices are computed from `answers`, not sent in. */
export const leadSchema = contactSchema.extend({
  source: z.enum(["quote_form", "estimator"]),
  project_type: opt(60),
  approx_size: opt(120),
  material: opt(60),
  height: opt(60),
  railing: opt(120),
  stairs: opt(120),
  notes: opt(2000),
  address: opt(200),
  contact_method: z.enum(["phone", "text", "email"]).optional(),
  timing: opt(40),
  wants_financing: z.boolean().optional(),
  answers: z.record(z.unknown()).optional(),
  // Honeypot: real visitors never see or fill this field.
  company: z.string().max(0).optional(),
});

export type Lead = z.input<typeof leadSchema>;

const FAILED = "Something went wrong sending your request. Please try again or call us.";

/** Emails the lead to Turner's Decks through Web3Forms. */
export async function submitLead(lead: Lead): Promise<void> {
  const { buildSubmission, WEB3FORMS_URL } = await import("./lead");
  const built = buildSubmission(lead);
  if (!built.ok) {
    if ("spam" in built) return; // honeypot filled: look successful, send nothing
    throw new Error(FAILED);
  }
  if (!built.payload.access_key) {
    console.error("Web3Forms access key is missing (SITE.web3formsKey in src/lib/site.ts)");
    throw new Error(FAILED);
  }
  let ok = false;
  try {
    const res = await fetch(WEB3FORMS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(built.payload),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
    ok = res.ok && data.success === true;
    if (!ok) console.error("Web3Forms rejected the submission", res.status, data.message);
  } catch (err) {
    console.error("Web3Forms request failed", err);
  }
  if (!ok) throw new Error(FAILED);
}
