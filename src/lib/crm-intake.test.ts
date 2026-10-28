import { describe, expect, it } from "vitest";
import { IntakeError, SubmissionKeys, attributionFrom, estimatorPayload, fetchEstimator, quotePayload, submitToCrm, type IntakePayload } from "./crm-intake";

const ctx = { submissionKey: "key-1", turnstileToken: "tok", href: "https://turnersdecks.com/estimator?utm_source=google&gclid=abc", referrer: "https://www.google.com/", viewportWidth: 390 };
const contact = { first_name: " Jane ", last_name: "Doe", email: "jane@example.com", phone: "6105550142", zip: "19518", website: "" };
const RESULT = { version: 1, low: 38000, high: 47000, belowMinimum: false, needsReview: false, sqft: 320, railingLf: 35, serviceArea: "primary" };

type Reply = Response | Error | "hang";
/** A fake fetch answering each call with the next reply, recording what was posted. */
function fakeFetch(...replies: Reply[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    if (r === "hang") {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    if (r instanceof Error) throw r;
    return r.clone();
  };
  return { fetch, calls };
}
const json = (status: number, body: unknown) => Response.json(body, { status });
const sleeps: number[] = [];
const opts = (f: ReturnType<typeof fakeFetch>, more = {}) => ({ baseUrl: "https://crm.example/", fetch: f.fetch, sleep: async (ms: number) => void sleeps.push(ms), ...more });
const payload = (): IntakePayload => estimatorPayload({ ...contact, timing: "Within 3 months", contact_method: "phone", wants_financing: true }, { version: 1, answers: { zip: "19518" }, defaulted: [] }, ctx);

describe("payload builders", () => {
  it("quotePayload carries the quote form's fields, trimmed, with key, token and attribution", () => {
    expect(quotePayload({ ...contact, project_type: "Pool deck", approx_size: " 16 x 20 ", material: "Composite", notes: "Pool." }, ctx)).toEqual({
      source: "quote_form", submission_key: "key-1", turnstile_token: "tok", website: "",
      first_name: "Jane", last_name: "Doe", email: "jane@example.com", phone: "6105550142", zip: "19518",
      project_type: "Pool deck", approx_size: "16 x 20", material: "Composite", notes: "Pool.",
      utm_source: "google", gclid: "abc", landing_page_url: ctx.href, referring_url: ctx.referrer, device_type: "mobile",
    });
  });

  it("estimatorPayload carries the contact details, version, answers and defaulted list", () => {
    const p = estimatorPayload(
      { ...contact, timing: "Next year", contact_method: "text", wants_financing: false, notes: "  Rot.  ", address: "12 Main St, Douglassville, PA" },
      { version: 4, answers: { material: "pvc", features: [] }, defaulted: ["material"] },
      ctx,
    );
    expect(p).toMatchObject({
      source: "estimator", timing: "Next year", contact_method: "text", wants_financing: false, notes: "Rot.",
      address: "12 Main St, Douglassville, PA", estimator_version: 4, answers: { material: "pvc", features: [] }, defaulted: ["material"],
    });
  });

  it("device type follows the viewport, and a page without tags has no UTM fields", () => {
    expect(attributionFrom({ href: "https://turnersdecks.com/", referrer: "", viewportWidth: 800 })).toEqual({ landing_page_url: "https://turnersdecks.com/", device_type: "tablet" });
    expect(attributionFrom({ href: "", referrer: "", viewportWidth: 1400 })).toEqual({ device_type: "desktop" });
  });

  it("SubmissionKeys keeps a key while the answers stay the same and makes a new one when they change", () => {
    const keys = new SubmissionKeys();
    const a = keys.keyFor({ x: 1 });
    expect(keys.keyFor({ x: 1 })).toBe(a);
    expect(keys.keyFor({ x: 2 })).not.toBe(a);
  });
});

describe("submitToCrm", () => {
  it("returns the CRM's price for an estimator submission", async () => {
    const f = fakeFetch(json(200, { ok: true, success: true, lead_id: "L1", estimate: RESULT }));
    expect(await submitToCrm(payload(), opts(f))).toEqual({ kind: "estimate", result: RESULT });
    expect(f.calls[0]!.url).toBe("https://crm.example/api/public/intake");
  });

  it("returns received for the quote form, or a honeypot success with no estimate", async () => {
    const f = fakeFetch(json(200, { ok: true, success: true }));
    expect(await submitToCrm(payload(), opts(f))).toEqual({ kind: "received" });
  });

  it("refuses a reply whose estimate is not a usable price", async () => {
    const f = fakeFetch(json(200, { ok: true, success: true, estimate: { ...RESULT, low: 50000 } }));
    await expect(submitToCrm(payload(), opts(f))).rejects.toMatchObject({ code: "invalid_estimate" });
  });

  it("retries a network error, a 5xx and a 202 with the same key and payload, with backoff", async () => {
    sleeps.length = 0;
    const f = fakeFetch(new TypeError("Failed to fetch"), json(503, {}), json(200, { ok: true, success: true, estimate: RESULT }));
    expect((await submitToCrm(payload(), opts(f))).kind).toBe("estimate");
    expect(f.calls).toHaveLength(3);
    expect(new Set(f.calls.map((c) => JSON.stringify(c.body))).size).toBe(1);
    expect(sleeps).toEqual([1000, 2500]);
  });

  it("retries while a twin is pending, then gives up after 3 attempts", async () => {
    const f = fakeFetch(json(202, { ok: true, success: false, pending: true }));
    const err = await submitToCrm(payload(), opts(f)).catch((e) => e);
    expect(err).toBeInstanceOf(IntakeError);
    expect(err.code).toBe("pending");
    expect(err.message).toMatch(/longer than usual/);
    expect(f.calls).toHaveLength(3);
  });

  it("gives up after 3 failed attempts with a plain-language message", async () => {
    const f = fakeFetch(json(500, { error: "intake_failed" }));
    await expect(submitToCrm(payload(), opts(f))).rejects.toMatchObject({ code: "http_500", message: expect.stringMatching(/call us/) });
    expect(f.calls).toHaveLength(3);
  });

  it("aborts an attempt after the timeout and retries it", async () => {
    const f = fakeFetch("hang", json(200, { ok: true, success: true }));
    expect(await submitToCrm(payload(), opts(f, { timeoutMs: 5 }))).toEqual({ kind: "received" });
    expect(f.calls).toHaveLength(2);
  });

  it("on 409 retries once under a new key, then stops", async () => {
    const ok = fakeFetch(json(409, { error: "fingerprint_mismatch" }), json(200, { ok: true, success: true }));
    expect(await submitToCrm(payload(), opts(ok, { newKey: () => "key-2" }))).toEqual({ kind: "received" });
    expect(ok.calls.map((c) => c.body.submission_key)).toEqual(["key-1", "key-2"]);
    expect(ok.calls[1]!.body.turnstile_token).toBe("tok");

    const twice = fakeFetch(json(409, { error: "fingerprint_mismatch" }));
    await expect(submitToCrm(payload(), opts(twice, { newKey: () => "key-2" }))).rejects.toMatchObject({ code: "fingerprint_mismatch" });
    expect(twice.calls).toHaveLength(2);
  });

  it.each([
    [403, { error: "turnstile_failed" }, "turnstile_failed", /security check/],
    [403, { error: "origin_not_allowed" }, "origin_not_allowed", /couldn't send/],
    [429, { error: "rate_limited" }, "rate_limited", /wait a minute/],
    [413, null, "http_413", /couldn't send/],
    [422, { error: "unknown_version" }, "unknown_version", /reload the page/],
    [422, { error: "missing_name_or_contact" }, "missing_name_or_contact", /name and a phone/],
  ])("treats %i %j as final", async (status, body, code, message) => {
    const f = fakeFetch(body === null ? new Response("Payload Too Large", { status }) : json(status, body));
    await expect(submitToCrm(payload(), opts(f))).rejects.toMatchObject({ code, message: expect.stringMatching(message) });
    expect(f.calls).toHaveLength(1);
  });

  it("passes the CRM's per-question errors on for invalid answers", async () => {
    const f = fakeFetch(json(422, { ok: false, success: false, error: "invalid_answers", errors: { material: "Choose one of the options." } }));
    await expect(submitToCrm(payload(), opts(f))).rejects.toMatchObject({ code: "invalid_answers", errors: { material: "Choose one of the options." } });
  });

  it("does not post without a CRM URL or a Turnstile token", async () => {
    const f = fakeFetch(json(200, { ok: true, success: true }));
    await expect(submitToCrm(payload(), opts(f, { baseUrl: "" }))).rejects.toMatchObject({ code: "not_configured" });
    await expect(submitToCrm({ ...payload(), turnstile_token: "" }, opts(f))).rejects.toMatchObject({ code: "turnstile_not_ready" });
    expect(f.calls).toHaveLength(0);
  });
});

describe("fetchEstimator", () => {
  const doc = {
    version: 2,
    steps: [{ title: "Project", items: [{ key: "projectType" }] }],
    questions: { projectType: { key: "projectType", kind: "choice", label: "What type?", default: null, optional: false, options: [{ value: "new", label: "New deck" }] } },
    serviceArea: { primaryZipPrefixes: ["195"], edgeZipPrefixes: [] },
    copy: {
      steps: ["Project", "Your estimate"], intro: "Hi", serviceArea: { primary: "p", edge: "e", outside: "o" },
      disclaimers: { primary: "a", redeck: "b", permit: "c", material: "d", homeownerDemo: "e", lighting: "f", neighbors: "g", townhouseHoa: "h" },
      included: ["x"], priceFactors: ["y"],
    },
  };

  it("loads and checks the public estimator", async () => {
    const f = fakeFetch(json(200, doc));
    expect(await fetchEstimator("https://crm.example", f.fetch)).toEqual(doc);
    expect(f.calls[0]!.url).toBe("https://crm.example/api/public/estimator");
  });

  it("throws on an error status, a malformed document, a network error or no URL", async () => {
    await expect(fetchEstimator("https://crm.example", fakeFetch(json(500, {})).fetch)).rejects.toThrow("estimator_http_500");
    await expect(fetchEstimator("https://crm.example", fakeFetch(json(200, { ...doc, questions: { projectType: { key: "other" } } })).fetch)).rejects.toThrow("estimator_invalid");
    await expect(fetchEstimator("https://crm.example", fakeFetch(new TypeError("offline")).fetch)).rejects.toThrow("offline");
    await expect(fetchEstimator("")).rejects.toThrow("estimator_not_configured");
  });
});
