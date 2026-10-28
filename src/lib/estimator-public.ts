// What the CRM's public estimator endpoint sends (GET /api/public/estimator) and the price intake sends back.
// Mirrors crm/src/lib/estimator/public.ts and relevance.ts; the site never imports CRM code (its deps are not
// ours). No dependencies, so the CRM's contract test can import it through crm-intake.ts.

export type QuestionKind = "choice" | "multi" | "sections" | "zip" | "number" | "toggle";

/** All conditions must hold. `in`: the answer is one of the values; `notIn`: it is not. An unanswered question is
 * neither in nor out, so the condition fails until it is answered. */
export type Condition = { question: string; in?: string[]; notIn?: string[] };
export type StepItem = { key: string; showIf?: Condition[] };

export type PublicOption = { value: string; label: string; hint?: string };

export type PublicQuestion = {
  key: string;
  kind: QuestionKind;
  label: string;
  help?: string;
  default: string | null;
  optional: boolean;
  options?: PublicOption[];
};

export type ServiceArea = "primary" | "edge" | "outside";

export type EstimatorCopy = {
  /** Eight question steps, then the contact step. */
  steps: string[];
  intro: string;
  serviceArea: Record<ServiceArea, string>;
  disclaimers: Record<"primary" | "redeck" | "permit" | "material" | "homeownerDemo" | "lighting" | "neighbors" | "townhouseHoa", string>;
  included: string[];
  priceFactors: string[];
};

export type PublicEstimator = {
  version: number;
  steps: { title: string; items: StepItem[] }[];
  questions: Record<string, PublicQuestion>;
  serviceArea: { primaryZipPrefixes: string[]; edgeZipPrefixes: string[] };
  copy: EstimatorCopy;
};

/** The price shown to the Homeowner, as priced and stored by the CRM. */
export type PublicResult = {
  version: number;
  low: number;
  high: number;
  belowMinimum: boolean;
  needsReview: boolean;
  sqft: number;
  railingLf: number;
  serviceArea: ServiceArea;
};

export type Section = { width: number; depth: number };
export type AnswerValue = string | string[] | Section[] | number | boolean;
export type Answers = Record<string, AnswerValue | undefined>;

// ---- Relevance (same rules as the CRM's relevance.ts, read from the payload) ----

export function holds(c: Condition, a: Answers): boolean {
  const v = a[c.question];
  if (typeof v !== "string") return false;
  if (c.in && !c.in.includes(v)) return false;
  if (c.notIn && c.notIn.includes(v)) return false;
  return true;
}

export const shown = (item: StepItem, a: Answers) => (item.showIf ?? []).every((c) => holds(c, a));

/** The items of one step shown for these answers. */
export const visibleItems = (est: PublicEstimator, step: number, a: Answers) => (est.steps[step]?.items ?? []).filter((i) => shown(i, a));

/** Every question shown for these answers, in step order, each once. */
export function visibleKeys(est: PublicEstimator, a: Answers): string[] {
  const keys = new Set<string>();
  for (let s = 0; s < est.steps.length; s++) for (const i of visibleItems(est, s, a)) keys.add(i.key);
  return [...keys];
}

// ---- Answer checks (the CRM's answers.ts limits) ----

export const MAX_SECTIONS = 5;
const inRange = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const enabled = (q: PublicQuestion) => (q.options ?? []).map((o) => o.value);

/** Why this shown question's answer would be refused, or null when it is fine. */
export function answerError(q: PublicQuestion, v: AnswerValue | undefined): string | null {
  switch (q.kind) {
    case "choice":
      if (typeof v === "string" && enabled(q).includes(v)) return null;
      return q.optional && v === undefined ? null : "Choose one of the options.";
    case "multi":
      if (v === undefined) return null;
      return Array.isArray(v) && v.every((x) => typeof x === "string" && enabled(q).includes(x)) && new Set<unknown>(v).size === v.length
        ? null
        : "Choose from the listed options.";
    case "sections":
      return Array.isArray(v) && v.length >= 1 && v.length <= MAX_SECTIONS && v.every((s) => isSection(s) && inRange(s.width, 3, 100) && inRange(s.depth, 3, 100))
        ? null
        : "Enter each section's width and depth in feet (3 to 100).";
    case "zip":
      return typeof v === "string" && /^\d{5}$/.test(v) ? null : "Enter a 5-digit ZIP code.";
    case "number":
      return v === undefined || inRange(v, 1, 1000) ? null : "Enter a length between 1 and 1,000 ft.";
    case "toggle":
      return v === undefined || typeof v === "boolean" ? null : "Expected yes or no.";
  }
}

const isSection = (s: unknown): s is Section => !!s && typeof s === "object" && typeof (s as Section).width === "number" && typeof (s as Section).depth === "number";

/**
 * Restored answers (sessionStorage) kept only where they still fit the loaded version: known questions, enabled
 * options, well-formed values. Anything else is dropped so the Homeowner answers it again.
 */
export function filterAnswers(est: PublicEstimator, raw: unknown): Answers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Answers = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const q = est.questions[k];
    if (!q) continue;
    if (q.kind === "choice" && typeof v === "string" && enabled(q).includes(v)) out[k] = v;
    if (q.kind === "multi" && Array.isArray(v)) out[k] = [...new Set(v.filter((x): x is string => typeof x === "string" && enabled(q).includes(x)))];
    if (q.kind === "sections" && Array.isArray(v) && v.length >= 1 && v.length <= MAX_SECTIONS && v.every(isSection)) {
      out[k] = v.map((s: Section) => ({ width: Number.isFinite(s.width) ? s.width : 0, depth: Number.isFinite(s.depth) ? s.depth : 0 }));
    }
    if (q.kind === "zip" && typeof v === "string") out[k] = v.replace(/\D/g, "").slice(0, 5);
    if (q.kind === "number" && typeof v === "number" && Number.isFinite(v)) out[k] = v;
    if (q.kind === "toggle" && typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Total square feet of the sections entered so far (plain arithmetic; pricing stays in the CRM). */
export const totalSqft = (sections: Section[] | undefined) =>
  Math.round((sections ?? []).reduce((n, s) => n + (s.width > 0 && s.depth > 0 ? s.width * s.depth : 0), 0));

/** Which service area a ZIP falls in, from the version's prefixes (no prices involved). */
export function serviceAreaFor(est: PublicEstimator, zip: string): ServiceArea {
  const pre = zip.slice(0, 3);
  if (est.serviceArea.primaryZipPrefixes.includes(pre)) return "primary";
  if (est.serviceArea.edgeZipPrefixes.includes(pre)) return "edge";
  return "outside";
}

/** The label of an answer in this version, or the raw value when it is not an option. */
export const optionLabel = (est: PublicEstimator, key: string, value: unknown) =>
  est.questions[key]?.options?.find((o) => o.value === value)?.label ?? String(value ?? "");

// ---- Validators for what comes over the wire ----

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const KINDS: readonly QuestionKind[] = ["choice", "multi", "sections", "zip", "number", "toggle"];
const AREAS: readonly ServiceArea[] = ["primary", "edge", "outside"];

function isCondition(c: unknown): c is Condition {
  return isObj(c) && isStr(c.question) && (c.in === undefined || isStrArr(c.in)) && (c.notIn === undefined || isStrArr(c.notIn));
}

function isQuestion(q: unknown, key: string): q is PublicQuestion {
  if (!isObj(q) || q.key !== key || !KINDS.includes(q.kind as QuestionKind) || !isStr(q.label)) return false;
  if (q.help !== undefined && !isStr(q.help)) return false;
  if (q.default !== null && !isStr(q.default)) return false;
  if (typeof q.optional !== "boolean") return false;
  if ((q.kind === "choice" || q.kind === "multi") && !Array.isArray(q.options)) return false;
  return q.options === undefined || (Array.isArray(q.options) && q.options.every((o) => isObj(o) && isStr(o.value) && isStr(o.label) && (o.hint === undefined || isStr(o.hint))));
}

/** The public estimator document, or null when the reply is not one this site can render. */
export function parsePublicEstimator(x: unknown): PublicEstimator | null {
  if (!isObj(x) || !Number.isSafeInteger(x.version) || (x.version as number) < 1) return null;
  if (!isObj(x.questions) || !Object.entries(x.questions).every(([k, q]) => isQuestion(q, k))) return null;
  const questions = x.questions as Record<string, PublicQuestion>;
  if (!Array.isArray(x.steps) || x.steps.length < 1) return null;
  for (const s of x.steps) {
    if (!isObj(s) || !isStr(s.title) || !Array.isArray(s.items)) return null;
    for (const i of s.items) {
      if (!isObj(i) || !isStr(i.key) || !questions[i.key]) return null;
      if (i.showIf !== undefined && !(Array.isArray(i.showIf) && i.showIf.every(isCondition))) return null;
    }
  }
  if (!isObj(x.serviceArea) || !isStrArr(x.serviceArea.primaryZipPrefixes) || !isStrArr(x.serviceArea.edgeZipPrefixes)) return null;
  const c = x.copy;
  if (!isObj(c) || !isStrArr(c.steps) || c.steps.length !== x.steps.length + 1 || !isStr(c.intro)) return null;
  if (!isObj(c.serviceArea) || !AREAS.every((a) => isStr((c.serviceArea as Record<string, unknown>)[a]))) return null;
  const d = c.disclaimers;
  if (!isObj(d) || !["primary", "redeck", "permit", "material", "homeownerDemo", "lighting", "neighbors", "townhouseHoa"].every((k) => isStr(d[k]))) return null;
  if (!isStrArr(c.included) || !isStrArr(c.priceFactors)) return null;
  return x as unknown as PublicEstimator;
}

/** The priced result from intake, or null when it is not a usable price. */
export function parsePublicResult(x: unknown): PublicResult | null {
  if (!isObj(x)) return null;
  const n = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!Number.isSafeInteger(x.version) || !n(x.low) || !n(x.high) || !n(x.sqft) || !n(x.railingLf)) return null;
  if (!((x.low as number) > 0 && (x.low as number) <= (x.high as number))) return null;
  if (typeof x.belowMinimum !== "boolean" || typeof x.needsReview !== "boolean" || !AREAS.includes(x.serviceArea as ServiceArea)) return null;
  return {
    version: x.version as number,
    low: x.low as number,
    high: x.high as number,
    belowMinimum: x.belowMinimum,
    needsReview: x.needsReview,
    sqft: x.sqft as number,
    railingLf: x.railingLf as number,
    serviceArea: x.serviceArea as ServiceArea,
  };
}

export const formatUSD = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
