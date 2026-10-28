// Deck price estimator (React island). Questions, options and copy come from the CRM's latest Published version
// (GET /api/public/estimator); the contact gate posts the answers to the CRM, which prices them and sends the range
// back (docs/adr/0003). This file is only the UI; no prices live on the site.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Phone, Plus, Trash2 } from "lucide-react";
import { Button, FieldError, Honeypot, Input, Label, LinkButton, Progress, SendError, Textarea, useFocusFirstError } from "@/components/ui/fields";
import { TurnstileBox, useTurnstile } from "@/components/ui/turnstile";
import { IntakeError, SubmissionKeys, estimatorPayload, fetchEstimator, submitToCrm, type EstimatorContact } from "@/lib/crm-intake";
import {
  answerError, filterAnswers, formatUSD, optionLabel, serviceAreaFor, totalSqft, visibleItems, visibleKeys,
  type AnswerValue, type Answers, type PublicEstimator, type PublicQuestion, type PublicResult, type Section,
} from "@/lib/estimator-public";
import { contactSchema, fieldErrors } from "@/lib/quote";
import { SITE } from "@/lib/site";

type Errs = Record<string, string>;
type Copy = PublicEstimator["copy"];
const storeKey = (version: number) => `td-estimator-v3:${version}`;
const EMPTY_SECTION: Section = { width: 0, depth: 0 };

const townhouseOrHoa = (a: Answers) => a.townhouse === "yes" || a.access === "townhouse" || a.hoa === "yes";

/** Disclaimers shown under a question once it is answered a certain way. */
const NOTES: { after: string; show: (a: Answers) => boolean; copy: keyof Copy["disclaimers"] }[] = [
  { after: "projectType", show: (a) => a.projectType === "redeck", copy: "redeck" },
  { after: "historic", show: townhouseOrHoa, copy: "townhouseHoa" },
  { after: "material", show: () => true, copy: "material" },
  { after: "demolition", show: (a) => a.demolition === "homeowner", copy: "homeownerDemo" },
  { after: "unstable", show: (a) => a.projectType === "redeck", copy: "redeck" },
  { after: "lighting", show: (a) => a.lighting !== undefined && a.lighting !== "none", copy: "lighting" },
  { after: "neighbors", show: (a) => a.neighbors !== undefined && a.neighbors !== "no", copy: "neighbors" },
];

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border-l-4 border-accent-blue bg-secondary p-4 text-sm text-muted-foreground">{children}</p>;
}

const legendCls = "font-heading font-semibold text-primary";

export default function Estimator() {
  const [est, setEst] = useState<PublicEstimator | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(() => {
    setLoadFailed(false);
    fetchEstimator()
      .then(setEst)
      .catch((err) => {
        console.error("[estimator]", err);
        setLoadFailed(true);
      });
  }, []);
  useEffect(load, [load]);

  if (est) return <Wizard est={est} />;
  if (loadFailed) {
    return (
      <div className="mt-8 rounded-xl bg-card p-6 text-center shadow-card md:p-10" role="alert">
        <p className="font-heading text-xl font-semibold text-primary">We couldn't load the estimator right now.</p>
        <p className="mt-2 text-muted-foreground">Please try again, or call {SITE.ownerFirst} and we'll talk through your project and price over the phone.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <LinkButton href={SITE.phoneHref} variant="cta" size="lg"><Phone className="size-4" aria-hidden="true" /> Call {SITE.phone}</LinkButton>
          <Button variant="outline" size="lg" onClick={load}>Try again</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-8 rounded-xl bg-card p-6 text-center text-muted-foreground shadow-card md:p-10" role="status">
      Loading the estimator…
    </div>
  );
}

type Done = { kind: "estimate"; result: PublicResult } | { kind: "received" };

function Wizard({ est }: { est: PublicEstimator }) {
  const questionSteps = est.steps.length;
  const total = questionSteps + 1;
  const titles = est.copy.steps;
  const [a, setA] = useState<Answers>({});
  // Shown questions still on the default the estimator picked, never changed by the Homeowner.
  const [defaulted, setDefaulted] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errs>({});
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const keys = useRef(new SubmissionKeys());
  // What the Homeowner typed on the contact step, kept when they go back to fix an answer.
  const contactDraft = useRef<Record<string, string>>({});

  // Restore this version's answers from earlier in the session, keeping only what still fits the document.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const s = sessionStorage.getItem(storeKey(est.version));
      if (s) {
        const saved = JSON.parse(s) as { answers?: unknown; defaulted?: unknown };
        const answers = filterAnswers(est, saved.answers);
        setA(answers);
        if (Array.isArray(saved.defaulted)) {
          setDefaulted(saved.defaulted.filter((k): k is string => typeof k === "string" && answers[k] !== undefined && answers[k] === est.questions[k]?.default));
        }
      }
    } catch { /* storage unavailable or unreadable */ }
    setRestored(true);
  }, [est]);
  useEffect(() => {
    if (!restored || done) return;
    try { sessionStorage.setItem(storeKey(est.version), JSON.stringify({ answers: a, defaulted })); } catch { /* storage unavailable */ }
  }, [a, defaulted, restored, done, est.version]);

  // A question's default (and an empty first section) is filled in the first time the question is shown.
  useEffect(() => {
    if (!restored || step >= questionSteps) return;
    const patch: Answers = {};
    const picked: string[] = [];
    for (const { key } of visibleItems(est, step, a)) {
      const q = est.questions[key]!;
      if (a[key] !== undefined) continue;
      if (q.kind === "sections") patch[key] = [EMPTY_SECTION];
      else if (q.kind === "choice" && q.default !== null && q.options?.some((o) => o.value === q.default)) {
        patch[key] = q.default;
        picked.push(key);
      }
    }
    if (!Object.keys(patch).length) return;
    setA((x) => ({ ...x, ...patch }));
    if (picked.length) setDefaulted((d) => [...new Set([...d, ...picked])]);
  }, [est, step, a, restored, questionSteps]);

  // Each step change moves focus to the step's heading, unless an error is about to take it.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (Object.keys(errors).length) return;
    headingRef.current?.focus();
  }, [step, done]);
  useFocusFirstError(rootRef, errors);

  const set = (key: string, value: AnswerValue | undefined) => {
    setA((x) => ({ ...x, [key]: value }));
    setDefaulted((d) => d.filter((k) => k !== key));
  };

  function stepErrors(s: number, answers: Answers): Errs {
    const e: Errs = {};
    for (const { key } of visibleItems(est, s, answers)) {
      const q = est.questions[key]!;
      const msg = answerError(q, answers[key]) ?? (!q.optional && answers[key] === undefined ? "This question needs an answer." : null);
      if (msg) e[key] = msg;
    }
    return e;
  }

  const goTo = (s: number) => {
    setErrors({});
    setServerError("");
    setStep(s);
    window.scrollTo({ top: 0 });
  };
  const next = () => {
    const e = stepErrors(step, a);
    if (Object.keys(e).length) return setErrors(e);
    goTo(step + 1);
  };

  /** Back to the first step with a missing or refused answer (a later answer can make an earlier question apply). */
  function sendBack(e: Errs): boolean {
    for (let s = 0; s < questionSteps; s++) {
      const here = visibleItems(est, s, a).filter((i) => e[i.key]);
      if (!here.length) continue;
      setStep(s);
      setErrors(Object.fromEntries(here.map((i) => [i.key, e[i.key]!])));
      window.scrollTo({ top: 0 });
      return true;
    }
    return false;
  }

  /** Resolves false when the Turnstile token was spent on a send that failed (the form then gets a fresh one). */
  async function submit(fd: Record<string, string>, token: string | null): Promise<boolean> {
    for (let s = 0; s < questionSteps; s++) {
      const e = stepErrors(s, a);
      if (Object.keys(e).length) {
        sendBack(e);
        return true;
      }
    }
    const parsed = contactSchema.safeParse({ ...fd, zip: typeof a.zip === "string" ? a.zip : "" });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return true;
    }
    setErrors({});
    setSending(true);
    setServerError("");
    const shownKeys = visibleKeys(est, a);
    const answers: Answers = Object.fromEntries(shownKeys.flatMap((k) => (a[k] === undefined ? [] : [[k, a[k]]])));
    const contact: EstimatorContact = {
      ...parsed.data,
      website: fd.website ?? "",
      timing: fd.timing ?? "",
      contact_method: fd.contact_method === "text" || fd.contact_method === "email" ? fd.contact_method : "phone",
      wants_financing: fd.financing === "on",
      notes: fd.notes,
      address: fd.address,
    };
    const estimate = {
      version: est.version,
      answers,
      defaulted: defaulted.filter((k) => shownKeys.includes(k) && a[k] === est.questions[k]?.default),
    };
    try {
      const out = await submitToCrm(
        estimatorPayload(contact, estimate, {
          submissionKey: keys.current.keyFor({ contact, estimate }),
          turnstileToken: token ?? "",
          href: window.location.href,
          referrer: document.referrer,
          viewportWidth: window.innerWidth,
        }),
      );
      try { sessionStorage.removeItem(storeKey(est.version)); } catch { /* storage unavailable */ }
      setDone(out);
      window.scrollTo({ top: 0 });
      return true;
    } catch (err) {
      console.error("[crm-intake]", err);
      // The CRM refused some answers: show them where they were asked. Otherwise keep everything and offer the phone.
      if (err instanceof IntakeError && err.errors && sendBack(err.errors)) return false;
      setServerError((err as Error).message);
      return false;
    } finally {
      setSending(false);
    }
  }

  const pct = done ? 100 : (step / total) * 100;
  const sqft = totalSqft(a.sections as Section[] | undefined);
  const heading = done ? "Your estimate" : titles[step];

  return (
    <div ref={rootRef}>
      <p className="mt-2 max-w-2xl text-muted-foreground">{est.copy.intro}</p>
      <div className="mt-8">
        <div className="mb-2 flex justify-between text-sm text-muted-foreground">
          <span>{done ? "Your estimate" : `Step ${step + 1} of ${total}: ${titles[step]}`}</span>
          {step > 0 && !done && (
            <button type="button" onClick={() => goTo(step - 1)} className="-my-2 -mr-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 font-medium text-accent-blue hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ArrowLeft className="size-4" /> Back
            </button>
          )}
        </div>
        <Progress value={pct} aria-label="Estimator progress" />
      </div>

      {done ? (
        <Result est={est} a={a} done={done} headingRef={headingRef} />
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-7 rounded-xl bg-card p-6 shadow-card md:p-8">
            <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold focus:outline-none">{heading}</h2>

            {step < questionSteps &&
              visibleItems(est, step, a).map(({ key }) => (
                <div key={key} className="space-y-4">
                  <QuestionField q={est.questions[key]!} value={a[key]} error={errors[key]} sqft={sqft} onChange={(v) => set(key, v)} />
                  {NOTES.filter((n) => n.after === key && n.show(a)).map((n) => <Note key={n.copy}>{est.copy.disclaimers[n.copy]}</Note>)}
                </div>
              ))}

            {step === questionSteps && (
              <ContactStep
                message={est.copy.serviceArea[serviceAreaFor(est, typeof a.zip === "string" ? a.zip : "")]}
                draft={contactDraft}
                errors={errors}
                sending={sending}
                serverError={serverError}
                onSubmit={submit}
              />
            )}

            {step < questionSteps && (
              <div className="flex justify-end border-t pt-5">
                <Button type="button" variant="cta" size="lg" onClick={next}>Continue <ArrowRight className="size-4" /></Button>
              </div>
            )}
          </div>

          <aside className="h-fit rounded-xl bg-card p-5 shadow-card lg:sticky lg:top-24">
            <p className="eyebrow">Your project so far</p>
            <dl className="mt-3 space-y-2 text-sm">
              {a.projectType !== undefined && <div><dt className="text-muted-foreground">Project</dt><dd className="font-medium">{optionLabel(est, "projectType", a.projectType)}</dd></div>}
              {sqft > 0 && <div><dt className="text-muted-foreground">Size</dt><dd className="font-medium">About {sqft} sq ft</dd></div>}
              {a.material !== undefined && <div><dt className="text-muted-foreground">Material</dt><dd className="font-medium">{optionLabel(est, "material", a.material)}</dd></div>}
              {step > 4 && a.railingSides !== undefined && <div><dt className="text-muted-foreground">Railing</dt><dd className="font-medium">{a.railingSides === "none" ? "None" : optionLabel(est, "railingStyle", a.railingStyle)}</dd></div>}
              {step > 5 && a.stairType !== undefined && <div><dt className="text-muted-foreground">Stairs</dt><dd className="font-medium">{optionLabel(est, "stairType", a.stairType)}</dd></div>}
            </dl>
          </aside>
        </div>
      )}
    </div>
  );
}

function QuestionField({ q, value, error, sqft, onChange }: { q: PublicQuestion; value: AnswerValue | undefined; error?: string; sqft: number; onChange: (v: AnswerValue | undefined) => void }) {
  const errId = `${q.key}-error`;
  const help = q.help ? <p id={`${q.key}-help`} className="text-sm text-muted-foreground">{q.help}</p> : null;
  const describedBy = [q.help && `${q.key}-help`, error && errId].filter(Boolean).join(" ") || undefined;

  if (q.kind === "choice") {
    const opts = q.options ?? [];
    const narrow = opts.length <= 3 && opts.every((o) => !o.hint && o.label.length <= 16);
    return (
      <fieldset className="space-y-2" aria-describedby={describedBy}>
        <legend className={legendCls}>{q.label}</legend>
        {help}
        <div className={`grid gap-2 ${narrow ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {opts.map((o) => {
            const on = value === o.value;
            return (
              <label key={o.value} className={`flex cursor-pointer items-start gap-2 rounded-lg border-2 p-3 text-left transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${on ? "border-accent-blue bg-accent-blue/5" : "border-border hover:border-accent-blue/50"}`}>
                <input type="radio" name={`q-${q.key}`} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" aria-invalid={error ? true : undefined} />
                <span aria-hidden="true" className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-accent-blue bg-accent-blue text-primary-foreground" : "border-border"}`}>{on && <Check className="size-3" />}</span>
                <span><span className="block font-medium">{o.label}</span>{o.hint && <span className="block text-sm text-muted-foreground">{o.hint}</span>}</span>
              </label>
            );
          })}
        </div>
        <FieldError id={errId} message={error} />
      </fieldset>
    );
  }

  if (q.kind === "multi") {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="space-y-2" aria-describedby={describedBy}>
        <legend className={legendCls}>{q.label}</legend>
        {help}
        <div className="grid gap-2 sm:grid-cols-3">
          {(q.options ?? []).map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input type="checkbox" className="size-4" checked={list.includes(o.value)} aria-invalid={error ? true : undefined}
                onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))} /> {o.label}
            </label>
          ))}
        </div>
        <FieldError id={errId} message={error} />
      </fieldset>
    );
  }

  if (q.kind === "toggle") {
    return (
      <div>
        <label className="flex items-center gap-3"><input type="checkbox" className="size-5" checked={value === true} aria-describedby={describedBy} onChange={(e) => onChange(e.target.checked)} /> {q.label}</label>
        {help}
        <FieldError id={errId} message={error} />
      </div>
    );
  }

  if (q.kind === "sections") {
    const sections = Array.isArray(value) && value.length ? (value as Section[]) : [EMPTY_SECTION];
    const ok = (n: number) => n >= 3 && n <= 100;
    return (
      <fieldset className="space-y-3" aria-describedby={describedBy}>
        <legend className={legendCls}>{q.label}</legend>
        {help}
        {sections.map((s, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-3">
            <span className="w-20 pb-3 text-sm font-medium">Section {idx + 1}</span>
            {(["width", "depth"] as const).map((d) => (
              <div key={d} className="w-32">
                <Label htmlFor={`s${idx}-${d}`}>{d === "width" ? "Width (ft)" : "Depth (ft)"}</Label>
                <Input id={`s${idx}-${d}`} type="number" inputMode="decimal" min={3} max={100} value={s[d] || ""} className="mt-1 h-11"
                  aria-invalid={!!error && !ok(s[d])} aria-describedby={error ? errId : undefined}
                  onChange={(e) => onChange(sections.map((x, j) => (j === idx ? { ...x, [d]: Number(e.target.value) } : x)))} />
              </div>
            ))}
            {sections.length > 1 && (
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove section ${idx + 1}`} onClick={() => onChange(sections.filter((_, j) => j !== idx))}><Trash2 className="size-4" /></Button>
            )}
          </div>
        ))}
        <FieldError id={errId} message={error} />
        {sections.length < 5 && (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...sections, EMPTY_SECTION])}><Plus className="size-4" /> Add a section</Button>
        )}
        {sqft > 0 && <p className="font-medium">Total: about {sqft} sq ft</p>}
      </fieldset>
    );
  }

  // zip and number: one text box.
  const box = { id: `q-${q.key}`, className: "mt-1.5 h-11 w-40", "aria-invalid": !!error, "aria-describedby": describedBy };
  return (
    <div>
      <Label htmlFor={box.id} className={legendCls}>{q.label}</Label>
      {help}
      {q.kind === "zip" ? (
        <Input {...box} inputMode="numeric" maxLength={5} autoComplete="postal-code" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} />
      ) : (
        <Input {...box} type="number" min={1} max={1000} value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
      )}
      <FieldError id={errId} message={error} />
    </div>
  );
}

function ContactStep({ message, draft, errors, sending, serverError, onSubmit }: {
  message: string;
  draft: RefObject<Record<string, string>>;
  errors: Errs;
  sending: boolean;
  serverError: string;
  onSubmit: (fd: Record<string, string>, token: string | null) => Promise<boolean>;
}) {
  const turnstile = useTurnstile();
  const d = draft.current;
  const keep = (ev: FormEvent<HTMLFormElement>) => {
    draft.current = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>;
  };
  async function handle(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    keep(ev);
    const ok = await onSubmit(draft.current, turnstile.token);
    // Tokens are single use: a failed send needs a fresh one.
    if (!ok && turnstile.token) turnstile.reset();
  }
  return (
    <form onSubmit={handle} onChange={keep} noValidate className="relative space-y-5">
      <Honeypot />
      <div className="rounded-lg bg-secondary p-4">
        <p className="font-heading font-semibold text-primary">{message}</p>
        <p className="mt-2 text-sm text-muted-foreground">Your price range and project summary appear on the next screen. {SITE.ownerFirst} gets a copy, to follow up and confirm the price at a free site visit. No sales team, and we never share your details.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {([["first_name", "First name", "given-name", "text"], ["last_name", "Last name", "family-name", "text"], ["email", "Email", "email", "email"], ["phone", "Phone", "tel", "tel"]] as const).map(([n, l, ac, t]) => (
          <div key={n}>
            <Label htmlFor={`e-${n}`}>{l}</Label>
            <Input id={`e-${n}`} name={n} type={t} autoComplete={ac} defaultValue={d[n]} className="mt-1.5 h-11 text-base" aria-invalid={!!errors[n]} aria-describedby={errors[n] ? `e-${n}-error` : undefined} />
            <FieldError id={`e-${n}-error`} message={errors[n]} />
          </div>
        ))}
        <div className="sm:col-span-2">
          <Label htmlFor="e-address">Project address (optional)</Label>
          <Input id="e-address" name="address" autoComplete="street-address" maxLength={200} defaultValue={d.address} className="mt-1.5 h-11 text-base" />
        </div>
        <div>
          <Label htmlFor="e-cm">Best way to reach you</Label>
          <select id="e-cm" name="contact_method" defaultValue={d.contact_method} className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-3 text-base">
            <option value="phone">Phone call</option><option value="text">Text</option><option value="email">Email</option>
          </select>
        </div>
        <div>
          <Label htmlFor="e-timing">When would you like it built?</Label>
          <select id="e-timing" name="timing" defaultValue={d.timing} className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-3 text-base">
            <option>As soon as possible</option><option>Within 3 months</option><option>3–6 months</option><option>Next year</option><option>Just planning</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="e-notes">Anything else we should know? (optional)</Label>
          <Textarea id="e-notes" name="notes" maxLength={2000} rows={3} defaultValue={d.notes} className="mt-1.5" />
        </div>
        <label className="flex items-center gap-3 sm:col-span-2"><input type="checkbox" name="financing" defaultChecked={d.financing === "on"} className="size-5" /> Send me financing information</label>
      </div>
      <TurnstileBox boxRef={turnstile.ref} />
      <p className="text-xs text-muted-foreground">We only use your information to follow up on this project. We never sell it.</p>
      <SendError message={serverError} />
      <Button type="submit" variant="cta" size="lg" className="w-full" disabled={sending}>{sending ? "Sending…" : "Show My Price Range"}</Button>
    </form>
  );
}

function Result({ est, a, done, headingRef }: { est: PublicEstimator; a: Answers; done: Done; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const d = est.copy.disclaimers;
  if (done.kind === "received") {
    return (
      <div className="mt-8 rounded-xl bg-card p-8 text-center shadow-card" role="status">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold focus:outline-none">Thanks, we got it.</h2>
        <p className="mt-2 text-muted-foreground">{SITE.ownerFirst} will reach out {SITE.responseTime}. Need us sooner? <a href={SITE.phoneHref} className="font-semibold text-accent-blue underline">Call {SITE.phone}</a></p>
      </div>
    );
  }
  const r = done.result;
  const label = (k: string) => optionLabel(est, k, a[k]);
  const summary: [string, string][] = [
    ["Project", label("projectType")],
    ["Size", `About ${r.sqft} sq ft`],
    ["Material", label("material")],
    ["Railing", a.railingSides === "none" ? "None" : `${label("railingStyle")}, about ${r.railingLf} ft`],
    ["Stairs", label("stairType")],
    ["Existing deck", label("demolition")],
    ["ZIP code", typeof a.zip === "string" ? a.zip : ""],
  ];
  return (
    <div className="mt-8 space-y-6">
      <div className="rounded-xl bg-card p-6 text-center shadow-card md:p-10">
        <h2 ref={headingRef} tabIndex={-1} className="sr-only focus:outline-none">Your estimate</h2>
        <p className="text-muted-foreground">Based on the information provided, a realistic preliminary investment range for your project is:</p>
        <p className="mt-3 font-heading text-4xl font-bold text-primary md:text-5xl">{formatUSD(r.low)} – {formatUSD(r.high)}</p>
        {r.belowMinimum && <p className="mx-auto mt-3 max-w-lg text-sm">Projects of this type typically begin around {formatUSD(r.low)}, depending on access, structure, materials, and project requirements.</p>}
        {r.needsReview && (
          <p className="mx-auto mt-4 flex max-w-lg items-start gap-2 rounded-lg bg-secondary p-3 text-left text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-blue" /> Some parts of your project need a site-specific review, so this range is wider than usual. We'll firm it up at the site visit.
          </p>
        )}
        <p className="mx-auto mt-4 max-w-2xl text-sm font-medium">{est.copy.serviceArea[r.serviceArea]}</p>
        <p className="mx-auto mt-5 max-w-2xl text-sm text-muted-foreground">{d.primary}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <LinkButton href={SITE.phoneHref} variant="cta" size="lg"><Phone className="size-4" aria-hidden="true" /> Call {SITE.phone}</LinkButton>
          <LinkButton href="/gallery" variant="outline" size="lg">See Our Work</LinkButton>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{SITE.ownerFirst} has your details and will reach out {SITE.responseTime} to book your free site visit. Want it sooner? Give us a call.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl bg-card p-6 shadow-card">
          <h2 className="text-xl font-semibold">Your project summary</h2>
          <dl className="mt-4 divide-y text-sm">
            {summary.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
            ))}
          </dl>
        </div>
        <div className="space-y-6">
          <div className="rounded-xl bg-card p-6 shadow-card">
            <h2 className="text-xl font-semibold">Included in this estimate</h2>
            <ul className="mt-4 space-y-2 text-sm">{est.copy.included.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-accent-blue" />{x}</li>)}</ul>
          </div>
          <div className="rounded-xl bg-card p-6 shadow-card">
            <h2 className="text-xl font-semibold">Final pricing may be affected by</h2>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{est.copy.priceFactors.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        </div>
      </div>

      <div className="space-y-3 text-sm text-muted-foreground">
        {a.projectType === "redeck" && <Note>{d.redeck}</Note>}
        {townhouseOrHoa(a) && <Note>{d.townhouseHoa} <a href={SITE.phoneHref} className="font-medium text-accent-blue underline">{SITE.phone}</a></Note>}
        <Note>{d.permit}</Note>
        <Note>{d.material}</Note>
      </div>
    </div>
  );
}
