// "Get a free estimate" form (React island). Posts the lead to the CRM intake (lib/crm-intake.ts).
import { useRef, useState, type ComponentProps, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button, FieldError, Honeypot, Input, Label, SendError, SmsConsent, Textarea, useFocusFirstError } from "@/components/ui/fields";
import { TurnstileBox, useTurnstile } from "@/components/ui/turnstile";
import { SubmissionKeys, quotePayload, submitToCrm } from "@/lib/crm-intake";
import { fieldErrors, quoteSchema } from "@/lib/quote";
import { SITE } from "@/lib/site";

const selectCls = "flex h-12 w-full rounded-lg border px-3 text-base";
// White fields with dark text on both tones; the navy band drops the field border, as the white fill carries it.
const tones = {
  light: { field: "border-input bg-white text-[#121212]", form: "rounded-2xl bg-card p-6 shadow-card md:p-8" },
  dark: { field: "border-transparent bg-white text-[#121212]", form: "" },
};

/** `onDark` is for a navy (`on-dark`) section: no card, white fields, white pill button. */
export default function QuoteForm({ defaultProject, onDark = false }: { defaultProject?: string; onDark?: boolean }) {
  const tone = onDark ? tones.dark : tones.light;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [serverError, setServerError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, errors);
  const turnstile = useTurnstile();
  const keys = useRef(new SubmissionKeys());

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const parsed = quoteSchema.safeParse(data);
    if (!parsed.success) {
      // A new attempt that fails validation sent nothing: drop the previous send failure.
      setStatus("idle");
      setServerError("");
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setServerError("");
    setStatus("sending");
    const fields = { ...parsed.data, website: data.website ?? "", sms_consent: data.sms_consent === "on" };
    try {
      await submitToCrm(
        quotePayload(fields, {
          submissionKey: keys.current.keyFor(fields),
          turnstileToken: turnstile.token ?? "",
          href: window.location.href,
          referrer: document.referrer,
          viewportWidth: window.innerWidth,
        }),
      );
      setStatus("done");
    } catch (err) {
      console.error("[crm-intake]", err);
      if (turnstile.token) turnstile.reset();
      setServerError((err as Error).message);
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className={onDark ? "" : "rounded-2xl bg-card p-8 shadow-card"} role="status">
        <CheckCircle2 className="size-12 text-stone" />
        <h3 className="mt-4 text-3xl">Thanks, we got it.</h3>
        <p className="mt-3 text-muted-foreground">{SITE.ownerFirst} will call you {SITE.responseTime} to set up your free on-site estimate.</p>
        <p className="mt-2 text-muted-foreground">Need us sooner? <a href={SITE.phoneHref} className="link inline-flex min-h-11 items-center">Call {SITE.phone}</a></p>
      </div>
    );
  }

  const field = (name: string, label: string, props: ComponentProps<"input"> = {}) => (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} className={`mt-1.5 h-12 rounded-lg text-base shadow-none ${tone.field}`} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-error` : undefined} {...props} />
      <FieldError id={`${name}-error`} message={errors[name]} />
    </div>
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className={`relative space-y-5 ${tone.form}`}>
      <Honeypot />
      <div className="grid gap-5 sm:grid-cols-2">
        {field("first_name", "First name", { autoComplete: "given-name" })}
        {field("last_name", "Last name", { autoComplete: "family-name" })}
        {field("email", "Email", { type: "email", autoComplete: "email" })}
        {field("phone", "Phone", { type: "tel", autoComplete: "tel", inputMode: "tel" })}
        {field("zip", "Zip code", { inputMode: "numeric", maxLength: 5, autoComplete: "postal-code" })}
        <div>
          <Label htmlFor="project_type">Project type</Label>
          <select id="project_type" name="project_type" defaultValue={defaultProject ?? ""} className={`mt-1.5 ${selectCls} ${tone.field}`} aria-invalid={!!errors["project_type"]} aria-describedby={errors["project_type"] ? "project_type-error" : undefined}>
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
          <select id="material" name="material" defaultValue="Not sure" className={`mt-1.5 ${selectCls} ${tone.field}`}>
            <option>Composite</option>
            <option>Capped PVC</option>
            <option>Pressure-treated wood</option>
            <option>Not sure</option>
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" name="notes" rows={4} maxLength={2000} className={`mt-1.5 rounded-lg text-base shadow-none ${tone.field}`} placeholder="Tell us about your yard, timeline, or anything else." />
      </div>
      <SmsConsent id="q-sms_consent" />
      <TurnstileBox boxRef={turnstile.ref} />
      {status === "error" && <SendError message={serverError} />}
      <Button type="submit" variant={onDark ? "light" : "cta"} size="lg" className="w-full sm:w-auto" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Request My Free Estimate"}
      </Button>
    </form>
  );
}
