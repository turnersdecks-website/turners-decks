// Talks to the CRM (crm/, docs/adr/0002 and 0003): both forms post to POST /api/public/intake, and the estimator
// loads its questions from GET /api/public/estimator. Ported from Good Cover's src/lib/crmIntake.ts.
//
// A `submission_key` names one logical submission: kept across retries of the same answers, replaced when the
// answers change. The CRM looks the key up before redeeming Turnstile, so a retry after a lost response gets the
// stored result (and the identical price). 202 = a twin is still processing, retry shortly. 409 = this key was used
// for other answers.
// The payload builders and submitToCrm use no Astro or browser globals: crm/test/intake-contract.test.ts runs them
// against the real intake inside the CRM's Workers test runtime.
import { parsePublicEstimator, parsePublicResult, type Answers, type PublicEstimator, type PublicResult } from "./estimator-public";

/** Build-time settings (`.env.example`). Empty when the CRM is not configured for this build. */
export const CRM_URL: string = (import.meta.env.PUBLIC_CRM_URL ?? "").replace(/\/+$/, "");
export const TURNSTILE_SITE_KEY: string = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** Turnstile `action` the CRM expects (crm/src/lib/turnstile.ts). */
export const TURNSTILE_ACTION = "intake";

const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 2_500];

export type PayloadContext = {
  submissionKey: string;
  turnstileToken: string;
  /** The page's URL and referrer, for the Lead's Attribution. */
  href: string;
  referrer: string;
  viewportWidth: number;
};

export type ContactFields = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  zip: string;
  /** The honeypot's value; people never see it, so it is empty for them. */
  website: string;
};

export type QuoteFields = ContactFields & { project_type: string; approx_size?: string; material?: string; notes?: string };

export type EstimatorContact = ContactFields & {
  timing: string;
  contact_method: "phone" | "text" | "email";
  wants_financing: boolean;
  notes?: string;
  address?: string;
};

export type EstimatorAnswers = { version: number; answers: Answers; defaulted: string[] };

/** UTM and click ids on the landing URL, plus page, referrer and device type. */
export function attributionFrom(ctx: Pick<PayloadContext, "href" | "referrer" | "viewportWidth">): Record<string, string> {
  let params = new URLSearchParams();
  try {
    params = new URL(ctx.href).searchParams;
  } catch { /* not a URL: no tags */ }
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
  const w = ctx.viewportWidth;
  return {
    ...Object.fromEntries(keys.flatMap((k) => (params.get(k) ? [[k, params.get(k)!.slice(0, 200)]] : []))),
    ...(ctx.href ? { landing_page_url: ctx.href.slice(0, 500) } : {}),
    ...(ctx.referrer ? { referring_url: ctx.referrer.slice(0, 500) } : {}),
    device_type: w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop",
  };
}

const trimmed = (v: string | undefined, max: number) => (v ?? "").trim().slice(0, max);

function contactPart(f: ContactFields) {
  return {
    website: f.website,
    first_name: trimmed(f.first_name, 60),
    last_name: trimmed(f.last_name, 60),
    email: trimmed(f.email, 255),
    phone: trimmed(f.phone, 30),
    zip: trimmed(f.zip, 5),
  };
}

const envelope = (ctx: PayloadContext) => ({
  submission_key: ctx.submissionKey,
  turnstile_token: ctx.turnstileToken,
  ...attributionFrom(ctx),
});

/** The quote form's JSON body. Pure. */
export function quotePayload(f: QuoteFields, ctx: PayloadContext) {
  return {
    source: "quote_form" as const,
    ...envelope(ctx),
    ...contactPart(f),
    project_type: trimmed(f.project_type, 60),
    approx_size: trimmed(f.approx_size, 60),
    material: trimmed(f.material, 40),
    notes: trimmed(f.notes, 2000),
  };
}

/** The estimator's JSON body: contact details, the Published version answered, the answers and which were defaults. Pure. */
export function estimatorPayload(f: EstimatorContact, e: EstimatorAnswers, ctx: PayloadContext) {
  return {
    source: "estimator" as const,
    ...envelope(ctx),
    ...contactPart(f),
    timing: trimmed(f.timing, 40),
    contact_method: f.contact_method,
    wants_financing: f.wants_financing,
    notes: trimmed(f.notes, 2000),
    address: trimmed(f.address, 200),
    estimator_version: e.version,
    answers: e.answers,
    defaulted: e.defaulted,
  };
}

export type IntakePayload = ReturnType<typeof quotePayload> | ReturnType<typeof estimatorPayload>;

export type IntakeResult = { kind: "estimate"; result: PublicResult } | { kind: "received" };

/** A failed send, worded for the Homeowner. `errors` names estimator questions the CRM refused. */
export class IntakeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly errors?: Record<string, string>,
  ) {
    super(message);
    this.name = "IntakeError";
  }
}

const SEND_FAILED = "We couldn't send your request. Please try again, or call us and we'll take it over the phone.";

/** Plain-language message for a final (non-retried) refusal. */
function refusal(status: number, code: string): string {
  if (code === "turnstile_failed") return "The security check didn't go through. Please try again.";
  if (status === 429) return "Too many tries in a short time. Please wait a minute and try again.";
  if (code === "invalid_answers") return "Some of your answers need another look. Please check them and try again.";
  if (code === "unknown_version" || code === "outdated_version") return "The estimator was just updated. Please reload the page and try again.";
  if (code === "missing_name_or_contact") return "Please enter your name and a phone number or email.";
  return SEND_FAILED;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type SubmitOptions = {
  baseUrl?: string;
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  /** A fresh submission key, used once if the CRM says the key belongs to other answers (409). */
  newKey?: () => string;
  timeoutMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Posts one Form submission. Retries the same key and payload (at most 3 attempts in all, with backoff) on network
 * errors, timeouts, 5xx and 202; on 409 retries once under a new key; any other 4xx is final. Resolves with the CRM's
 * price for an estimator submission, or `received`; throws an IntakeError with a message for the Homeowner.
 */
export async function submitToCrm(payload: IntakePayload, opts: SubmitOptions = {}): Promise<IntakeResult> {
  const baseUrl = (opts.baseUrl ?? CRM_URL).replace(/\/+$/, "");
  if (!baseUrl) throw new IntakeError("Our online form isn't available right now. Please call us and we'll take it over the phone.", "not_configured");
  if (!payload.turnstile_token) throw new IntakeError("Wait a moment for the security check to finish, then send again.", "turnstile_not_ready");
  const doFetch: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const sleep = opts.sleep ?? defaultSleep;
  let body = payload;
  let rotated = false;
  let last = "network_error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(BACKOFF_MS[attempt - 2] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!);
    const res = await postOnce(doFetch, `${baseUrl}/api/public/intake`, JSON.stringify(body), opts.timeoutMs ?? TIMEOUT_MS);
    if (res.kind === "retry") {
      last = res.code;
      continue;
    }
    const { status, json } = res;
    if (status === 200 && json.ok === true && json.success === true) {
      if (json.estimate === undefined) return { kind: "received" };
      const result = parsePublicResult(json.estimate);
      if (!result) throw new IntakeError(SEND_FAILED, "invalid_estimate");
      return { kind: "estimate", result };
    }
    if (status === 202 && json.pending === true) {
      last = "pending";
      continue;
    }
    if (status === 409 && !rotated) {
      // The key was used for other answers (e.g. a stale key): one more try under a new key. The token was not
      // redeemed (the CRM answers 409 before Turnstile), so it is still good.
      rotated = true;
      body = { ...body, submission_key: (opts.newKey ?? (() => crypto.randomUUID()))() };
      last = "fingerprint_mismatch";
      continue;
    }
    const code = typeof json.error === "string" && json.error ? json.error : `http_${status}`;
    const errors = isStringMap(json.errors) ? json.errors : undefined;
    throw new IntakeError(refusal(status, code), code, errors);
  }
  throw new IntakeError(
    last === "pending" ? "Your request is taking longer than usual to go through. Please wait a minute and try again." : SEND_FAILED,
    last,
  );
}

type Attempt = { kind: "retry"; code: string } | { kind: "answer"; status: number; json: Record<string, unknown> };

async function postOnce(doFetch: Fetch, url: string, body: string, timeoutMs: number): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: controller.signal,
      body,
    });
    if (res.status >= 500) return { kind: "retry", code: `http_${res.status}` };
    const json: unknown = await res.json().catch(() => null);
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      // 413 and friends may come from the edge without a JSON body.
      return { kind: "answer", status: res.status, json: {} };
    }
    return { kind: "answer", status: res.status, json: json as Record<string, unknown> };
  } catch {
    return { kind: "retry", code: controller.signal.aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

const isStringMap = (x: unknown): x is Record<string, string> =>
  !!x && typeof x === "object" && !Array.isArray(x) && Object.values(x).every((v) => typeof v === "string");

/** The latest Published version's questions and copy (no prices). Throws when the CRM is unreachable or replies oddly. */
export async function fetchEstimator(baseUrl: string = CRM_URL, doFetch: Fetch = (input, init) => fetch(input, init)): Promise<PublicEstimator> {
  const base = baseUrl.replace(/\/+$/, "");
  if (!base) throw new Error("estimator_not_configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(`${base}/api/public/estimator`, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`estimator_http_${res.status}`);
    const doc = parsePublicEstimator(await res.json().catch(() => null));
    if (!doc) throw new Error("estimator_invalid");
    return doc;
  } finally {
    clearTimeout(timer);
  }
}

/** Keeps one submission_key per logical submission: a new one whenever the answers change. */
export class SubmissionKeys {
  private last: { fingerprint: string; key: string } | null = null;

  keyFor(fields: unknown): string {
    const fingerprint = JSON.stringify(fields);
    if (this.last?.fingerprint !== fingerprint) this.last = { fingerprint, key: crypto.randomUUID() };
    return this.last.key;
  }
}
