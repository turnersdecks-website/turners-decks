// "Get a free estimate" form (React island). Emails the lead through Web3Forms.
import { useRef, useState, type ComponentProps, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button, FieldError, Honeypot, Input, Label, SendError, Textarea, useFocusFirstError } from "@/components/ui/fields";
import { quoteSchema, submitLead } from "@/lib/quote";

const selectCls =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function QuoteForm({ defaultProject }: { defaultProject?: string }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [serverError, setServerError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, errors);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const parsed = quoteSchema.safeParse(data);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setServerError("");
    setStatus("sending");
    try {
      await submitLead({ source: "quote_form", ...parsed.data, company: data.company ?? "" });
      setStatus("done");
    } catch (err) {
      setServerError((err as Error).message);
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-xl border bg-card p-8 text-center shadow-card" role="status">
        <CheckCircle2 className="mx-auto size-12 text-accent-blue" />
        <h3 className="mt-4 text-2xl font-semibold">Thanks, we got it.</h3>
        <p className="mt-2 text-muted-foreground">We'll reach out shortly to set up your free on-site estimate.</p>
      </div>
    );
  }

  const field = (name: string, label: string, props: ComponentProps<"input"> = {}) => (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} className="mt-1.5 h-11 text-base" aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-error` : undefined} {...props} />
      <FieldError id={`${name}-error`} message={errors[name]} />
    </div>
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="relative space-y-5 rounded-xl border bg-card p-6 shadow-card md:p-8">
      <Honeypot />
      <div className="grid gap-5 sm:grid-cols-2">
        {field("first_name", "First name", { autoComplete: "given-name" })}
        {field("last_name", "Last name", { autoComplete: "family-name" })}
        {field("email", "Email", { type: "email", autoComplete: "email" })}
        {field("phone", "Phone", { type: "tel", autoComplete: "tel", inputMode: "tel" })}
        {field("zip", "Zip code", { inputMode: "numeric", maxLength: 5, autoComplete: "postal-code" })}
        <div>
          <Label htmlFor="project_type">Project type</Label>
          <select id="project_type" name="project_type" defaultValue={defaultProject ?? ""} className={`mt-1.5 ${selectCls}`} aria-invalid={!!errors["project_type"]} aria-describedby={errors["project_type"] ? "project_type-error" : undefined}>
            <option value="" disabled>Choose one</option>
            <option>New deck</option>
            <option>Deck replacement</option>
            <option>Pool deck</option>
          </select>
          <FieldError id="project_type-error" message={errors["project_type"]} />
        </div>
        {field("approx_size", "Approximate size (optional)", { placeholder: "e.g. 12 x 16 ft" })}
        <div>
          <Label htmlFor="material">Preferred material</Label>
          <select id="material" name="material" defaultValue="Not sure" className={`mt-1.5 ${selectCls}`}>
            <option>Composite</option>
            <option>Capped PVC</option>
            <option>Pressure-treated wood</option>
            <option>Not sure</option>
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" name="notes" rows={4} maxLength={2000} className="mt-1.5 text-base" placeholder="Tell us about your yard, timeline, or anything else." />
      </div>
      {status === "error" && <SendError message={serverError} />}
      <Button type="submit" variant="cta" size="lg" className="w-full" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Request My Free Estimate"}
      </Button>
    </form>
  );
}
