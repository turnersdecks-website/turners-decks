// Contact-field validation for the quote form and the estimator's contact step. Sending is in crm-intake.ts.
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

/** Field errors from a failed parse, first message per field. */
export function fieldErrors(issues: z.ZodIssue[]): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const i of issues) errs[String(i.path[0])] ??= i.message;
  return errs;
}
