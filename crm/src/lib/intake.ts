import { type AnyColumn, and, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { getDb } from '#/db/client'
import type { BatchItem } from 'drizzle-orm/batch'
import { type SubmissionState, companySettings, consentEvents, formSubmissions, leadActivity, leads, submissionProcessing } from '#/db/schema'
import { addressKey } from '#/lib/address-key'
import { toE164 } from '#/lib/phone'
import { type OutboxEnv, enqueueJob, kickJobs } from '#/lib/outbox'
import { formAckEnvelope, ownerAlertEnvelope } from '#/lib/outbox-kinds'
import { type PricedEstimate, estimateEmail, isPricingFailure, priceEstimatorPayload, projectTypeLabel, snapshotInsert, usd } from '#/lib/intake-estimate'
import { customerIdFor } from '#/lib/customers.server'
import { leadCreated } from '#/lib/stage-history.server'
import { verifyTurnstile } from '#/lib/turnstile'

// Intake: turns a Form submission into a new or matched Lead (PLAN.md > Intake contract).
// CORS allowlist -> rate limit -> bounded body -> submission_key lookup -> Turnstile -> store + claim
// -> map, validate, dedupe -> one D1 batch.

export const SCHEMA_VERSION = 1
export const MAX_BODY_BYTES = 64 * 1024
const LEAD_SOURCE_WEBSITE = 'website'

const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'landing_page_url',
  'referring_url',
  'device_type',
] as const

/** `jobIds`: notification jobs this request committed, for the first send attempt after the response. */
export type IntakeResult = { status: number; body: Record<string, unknown>; jobIds?: string[] }

type LeadFields = {
  firstName: string
  lastName: string | null
  email: string | null
  emailLower: string | null
  phone: string | null
  phoneE164: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  serviceType: string | null
  message: string | null
}

export type IntakeEnv = Pick<
  Env,
  'DB' | 'ENVIRONMENT' | 'TURNSTILE_SECRET_KEY' | 'INTAKE_ALLOWED_ORIGINS' | 'INTAKE_RATE_LIMITER' | 'BETTER_AUTH_SECRET'
> &
  OutboxEnv

/** `POST` and `OPTIONS /api/public/intake` (PLAN.md > Intake contract). */
export async function handleIntake(request: Request, env: IntakeEnv): Promise<Response> {
  // CORS allowlist. A request with no Origin is not from a browser page; Turnstile still applies.
  const origin = request.headers.get('origin')
  const allowed = origin === null || allowedOrigins(env).includes(origin)
  if (!allowed) return Response.json(reject(403, 'origin_not_allowed').body, { status: 403, headers: { vary: 'Origin' } })
  const cors: Record<string, string> = origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, accept',
        'access-control-max-age': '86400',
      },
    })
  }

  // Per-IP rate limit (Workers Rate Limiting binding, wrangler.jsonc). Fails open if the binding errors:
  // Turnstile still stands in front of every new Form submission.
  const ip = request.headers.get('cf-connecting-ip')
  const limit = await env.INTAKE_RATE_LIMITER.limit({ key: `intake:${ip ?? 'unknown'}` }).catch(() => ({ success: true }))
  if (!limit.success) return Response.json(reject(429, 'rate_limited').body, { status: 429, headers: { ...cors, 'retry-after': '60' } })

  const { status, body, jobIds } = await receiveFormSubmission(env, request)
  if (jobIds?.length) kickJobs(env, jobIds)
  return Response.json(body, { status, headers: cors })
}

const CLAIM_MS = 60_000
type Db = ReturnType<typeof getDb>

async function receiveFormSubmission(env: IntakeEnv, request: Request): Promise<IntakeResult> {
  const raw = await readBoundedText(request, MAX_BODY_BYTES)
  if (raw === null) return reject(413, 'body_too_large')
  const payload = parseJsonObject(raw)
  const db = getDb(env.DB)
  const submissionKey = clientSubmissionKey(payload)
  const fingerprint = await sha256Hex(payload ? canonicalBusinessFields(payload) : raw)

  // Look up the logical submission first: a retry must not need a second Turnstile redemption.
  if (submissionKey) {
    const prior = await findSubmission(db, submissionKey)
    if (prior) return answerRetry(db, prior, fingerprint)
  }

  const turnstile = await verifyTurnstile({
    token: payload ? trimmedNonEmptyString(payload.turnstile_token) : null,
    secret: env.TURNSTILE_SECRET_KEY,
    strict: env.ENVIRONMENT !== 'development',
    allowedHostnames: allowedOrigins(env).map((o) => new URL(o).hostname),
    remoteIp: request.headers.get('cf-connecting-ip'),
  })
  if (!turnstile.human) {
    // A spent token under a known key is usually a concurrent twin of this very submission: answer as its
    // retry, or ask the client to retry shortly while the twin is still being stored.
    if (submissionKey && turnstile.spent) {
      const twin = await findSubmission(db, submissionKey)
      return twin ? answerRetry(db, twin, fingerprint) : pending()
    }
    return reject(403, 'turnstile_failed')
  }

  // Store the raw post and claim it in one batch; UNIQUE(submission_key) makes a concurrent twin lose cleanly.
  const submissionId = crypto.randomUUID()
  const receivedAt = new Date()
  const ip = request.headers.get('cf-connecting-ip')
  const claimedUntil = new Date(Date.now() + CLAIM_MS)
  try {
    await db.batch([
      db.insert(formSubmissions).values({
        id: submissionId,
        submissionKey: submissionKey ?? crypto.randomUUID(),
        fingerprint,
        receivedAt,
        schemaVersion: SCHEMA_VERSION,
        source: payload ? trimmedNonEmptyString(payload.source) : null,
        rawBody: raw,
        ipHash: ip ? await hmacHex(env.BETTER_AUTH_SECRET, `intake-ip:${ip}`) : null,
      }),
      db.insert(submissionProcessing).values({
        submissionId,
        state: 'processing',
        claimedUntil,
        attempts: 1,
      }),
    ])
  } catch (err) {
    const twin = submissionKey && isUniqueViolation(err) ? await findSubmission(db, submissionKey) : null
    if (twin) return answerRetry(db, twin, fingerprint)
    throw err
  }
  return processSubmission(db, { id: submissionId, rawBody: raw, receivedAt }, claimedUntil)
}

type PriorSubmission = {
  id: string
  fingerprint: string
  rawBody: string
  receivedAt: Date
  state: (typeof submissionProcessing.$inferSelect)['state']
  resultJson: string | null
  claimedUntil: Date | null
}

function findSubmission(db: Db, submissionKey: string): Promise<PriorSubmission | undefined> {
  return db
    .select({
      id: formSubmissions.id,
      fingerprint: formSubmissions.fingerprint,
      rawBody: formSubmissions.rawBody,
      receivedAt: formSubmissions.receivedAt,
      state: submissionProcessing.state,
      resultJson: submissionProcessing.resultJson,
      claimedUntil: submissionProcessing.claimedUntil,
    })
    .from(formSubmissions)
    .innerJoin(submissionProcessing, eq(submissionProcessing.submissionId, formSubmissions.id))
    .where(eq(formSubmissions.submissionKey, submissionKey))
    .get()
}

async function answerRetry(db: Db, prior: PriorSubmission, fingerprint: string): Promise<IntakeResult> {
  if (prior.fingerprint !== fingerprint) return reject(409, 'fingerprint_mismatch')
  if ((prior.state === 'processed' || prior.state === 'rejected') && prior.resultJson) return storedResult(prior)
  // Still in flight, or the first attempt died: whoever re-claims it finishes the job.
  const token = await claim(db, prior.id)
  return token ? processSubmission(db, prior, token) : pending()
}

/**
 * Admin Replay: runs Intake again from the stored raw body (no Turnstile, nothing re-received). Idempotent:
 * a processed submission answers with its stored result; one in flight answers pending.
 */
export async function replayFormSubmission(d1: D1Database, submissionId: string): Promise<IntakeResult> {
  const db = getDb(d1)
  const submission = await db
    .select({ id: formSubmissions.id, rawBody: formSubmissions.rawBody, receivedAt: formSubmissions.receivedAt })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, submissionId))
    .get()
  if (!submission) return reject(404, 'not_found')
  const token = await claim(db, submissionId, ['received', 'failed', 'rejected'])
  if (token) return processSubmission(db, submission, token)
  const state = await db.select().from(submissionProcessing).where(eq(submissionProcessing.submissionId, submissionId)).get()
  return state?.state === 'processed' && state.resultJson ? storedResult(state) : pending()
}

/**
 * Conditional claim: only one caller moves a submission into `processing`. Returns the claim token: the exact
 * `claimed_until` written, which fences every later write by this claimant (null = not claimed).
 */
async function claim(db: Db, submissionId: string, from: SubmissionState[] = ['received', 'failed']): Promise<Date | null> {
  const now = Date.now()
  const token = new Date(now + CLAIM_MS)
  const res = await db
    .update(submissionProcessing)
    .set({ state: 'processing', claimedUntil: token, attempts: sql`${submissionProcessing.attempts} + 1` })
    .where(
      and(
        eq(submissionProcessing.submissionId, submissionId),
        or(
          inArray(submissionProcessing.state, from),
          and(eq(submissionProcessing.state, 'processing'), lt(submissionProcessing.claimedUntil, new Date(now))),
        ),
      ),
    )
    .run()
  return res.meta.changes === 1 ? token : null
}

/** Our claim (token) still holds: the submission is `processing` under exactly the `claimed_until` we wrote. */
function claimHeld(submissionId: string, token: Date) {
  return and(
    eq(submissionProcessing.submissionId, submissionId),
    eq(submissionProcessing.state, 'processing'),
    eq(submissionProcessing.claimedUntil, token),
  )
}

/** Our claim was lost (expired and re-claimed): answer whatever the processor that took over stored. */
async function answerAfterLostClaim(db: Db, submissionId: string): Promise<IntakeResult> {
  const now = await db.select().from(submissionProcessing).where(eq(submissionProcessing.submissionId, submissionId)).get()
  return (now?.state === 'processed' || now?.state === 'rejected') && now.resultJson ? storedResult(now) : pending()
}

function storedResult(prior: Pick<PriorSubmission, 'state' | 'resultJson'>): IntakeResult {
  const body = JSON.parse(prior.resultJson!) as Record<string, unknown>
  return { status: body.success === true ? 200 : 422, body }
}

function pending(): IntakeResult {
  return { status: 202, body: { ok: true, success: false, pending: true } }
}

/** Intake proper, for a claimed Form submission: map, validate, match or create the Lead. */
async function processSubmission(
  db: Db,
  submission: { id: string; rawBody: string; receivedAt: Date },
  token: Date,
): Promise<IntakeResult> {
  const submissionId = submission.id
  const receivedAt = submission.receivedAt
  const payload = parseJsonObject(submission.rawBody)
  const markRejected = async (error: string, result: IntakeResult) => {
    const res = await db
      .update(submissionProcessing)
      .set({ state: 'rejected', error, resultJson: JSON.stringify(result.body), claimedUntil: null, processedAt: new Date() })
      .where(claimHeld(submissionId, token))
      .run()
    return res.meta.changes === 1 ? result : answerAfterLostClaim(db, submissionId)
  }
  // Honeypot (`website`, hidden from people): the bot is told it worked; nothing becomes a Lead.
  if (payload && trimmedNonEmptyString(payload.website)) {
    return markRejected('honeypot', { status: 200, body: { ok: true, success: true } })
  }
  const mapped = payload ? mapSitePayload(payload) : null
  const invalid = !payload ? 'invalid_json' : !mapped ? 'missing_name_or_contact' : null
  if (invalid || !mapped) return markRejected(invalid ?? 'invalid', reject(422, invalid ?? 'invalid'))

  try {
    // FLW-201: an estimator submission is priced against the Published version it names, before any Lead write.
    let estimate: PricedEstimate | undefined
    if (trimmedNonEmptyString(payload!.source) === 'estimator') {
      const priced = await priceEstimatorPayload(db, payload!, receivedAt.getTime())
      if (isPricingFailure(priced)) {
        const result = reject(422, priced.error)
        if (priced.errors) result.body.errors = priced.errors
        return markRejected(priced.error, result)
      }
      estimate = priced
      mapped.zip ??= priced.answers.zip
      mapped.serviceType ??= projectTypeLabel(priced)
    }
    // A twin request may create the same Homeowner's Lead between our lookup and our insert: the unique
    // phone/email index refuses ours, and the second pass attaches to theirs.
    for (let attempt = 1; ; attempt++) {
      try {
        return await upsertLead(db, { submissionId, token, receivedAt, payload: payload!, mapped, estimate })
      } catch (err) {
        if (attempt >= 2 || !isUniqueViolation(err)) throw err
      }
    }
  } catch (err) {
    const res = await db
      .update(submissionProcessing)
      .set({ state: 'failed', error: String(err).slice(0, 500), claimedUntil: null })
      .where(claimHeld(submissionId, token))
      .run()
    return res.meta.changes === 1 ? reject(500, 'intake_failed') : answerAfterLostClaim(db, submissionId)
  }
}

async function upsertLead(
  db: Db,
  {
    submissionId,
    token,
    receivedAt,
    payload,
    mapped,
    estimate,
  }: {
    submissionId: string
    token: Date
    receivedAt: Date
    payload: Record<string, unknown>
    mapped: LeadFields
    estimate?: PricedEstimate
  },
): Promise<IntakeResult> {
  const { byPhone, byEmail } = await findLeads(db, mapped)
  const existing = byPhone ?? byEmail
  const leadId = existing?.id ?? crypto.randomUUID()
  // Phone and email match different Leads: attach to the phone match (A), copy neither, flag A for review.
  const other = byPhone && byEmail && byPhone.id !== byEmail.id ? byEmail : undefined
  // The estimate rides in the stored result, so a retry of this submission gets the identical price.
  const body = { ok: true, success: true, lead_id: leadId, ...(estimate ? { estimate: estimate.publicResult } : {}) }
  const now = new Date()

  const writes: BatchItem<'sqlite'>[] = []
  // Plan 010 F4: the intake is public, so a phone or email that did not match this Lead is only noted for Staff to
  // confirm with the Homeowner, never written onto the Lead (a stranger could otherwise add their own contact).
  const newContact = existing && !other ? newContactOf(mapped, { byPhone, byEmail }) : null
  if (existing) {
    writes.push(fillEmptyFields(db, leadId, mapped, { existing, needsReview: !!other || !!newContact }))
  }
  if (newContact) {
    writes.push(
      db.insert(leadActivity).values({
        id: crypto.randomUUID(),
        leadId,
        kind: 'note',
        body: `This Form submission gave ${newContact}, which is not on this Lead yet. Confirm it with the Homeowner before adding it.`,
        dedupeKey: `newcontact:${submissionId}`,
        createdAt: receivedAt,
      }),
    )
  }
  if (other) {
    writes.push(
      db.insert(leadActivity).values({
        id: crypto.randomUUID(),
        leadId,
        kind: 'note',
        body: conflictNote(mapped, other),
        dedupeKey: `conflict:${submissionId}`,
        createdAt: receivedAt,
      }),
    )
  }
  if (!existing) {
    // A past Customer's new inquiry starts a new Lead tied to their Customer record (GLOSSARY Customer).
    const customerId = await customerIdFor(db, mapped)
    writes.push(
      db.insert(leads).values({
        id: leadId,
        ...mapped,
        customerId,
        addressKey: addressKey(mapped),
        stage: 'new',
        source: LEAD_SOURCE_WEBSITE,
        firstSource: LEAD_SOURCE_WEBSITE,
        attributionJson: attribution(payload),
        firstTouchJson: firstTouch(payload),
        createdAt: receivedAt,
        updatedAt: receivedAt,
      }),
      leadCreated(db, leadId, { reason: 'Website form' }),
    )
  }
  writes.push(
    db.insert(leadActivity).values({
      id: crypto.randomUUID(),
      leadId,
      kind: 'form',
      body: activitySummary(payload, estimate),
      dedupeKey: `form:${submissionId}`,
      createdAt: receivedAt,
    }),
  )
  if (estimate) writes.push(snapshotInsert(db, estimate, { leadId, submissionId, at: receivedAt }))
  // Text consent only from the explicit SMS checkbox; it happened when the Form submission was received.
  if (payload.sms_consent === true && mapped.phoneE164) {
    writes.push(
      db.insert(consentEvents).values({
        id: crypto.randomUUID(),
        phoneE164: mapped.phoneE164,
        program: 'sms_followup',
        event: 'grant',
        occurredAt: receivedAt,
        disclosureVersion: trimmedNonEmptyString(payload.sms_consent_disclosure)?.slice(0, 64) ?? null,
        source: 'form',
        sourceRef: submissionId,
        leadId,
        recordedAt: now,
      }),
    )
  }
  // Envelopes frozen now ("Emails sent", plan 006 S11), from the Lead as this batch leaves it (fillEmptyFields).
  const settings = await db.select().from(companySettings).where(eq(companySettings.id, 1)).get()
  if (!settings) throw new Error('company_settings row 1 is missing (migration 0003 seeds it)')
  const name = { firstName: existing ? (existing.firstName ?? mapped.firstName) : mapped.firstName, lastName: existing ? (existing.lastName ?? mapped.lastName) : mapped.lastName }
  // A matched Lead is acknowledged only at its stored email (plan 010 F4).
  const email = existing ? existing.email : mapped.email
  const envelopes = { owner_alert: ownerAlertEnvelope(name, settings), form_ack: formAckEnvelope({ email }, settings) }
  // FLW-201: an estimator submission gets its Estimate email instead of the acknowledgement, at the address given
  // in this Form submission (it only repeats what this Homeowner just saw), never a matched Lead's stored address.
  const jobKinds = estimate ? (['owner_alert'] as const) : email ? (['owner_alert', 'form_ack'] as const) : (['owner_alert'] as const)
  const jobIds: string[] = []
  for (const kind of jobKinds) {
    const envelope = envelopes[kind]
    const job = enqueueJob(db, {
      kind,
      dedupeKey: `${kind}:${submissionId}`,
      payload: { lead_id: leadId, submission_id: submissionId, ...envelope },
      envelope,
    })
    jobIds.push(job.id)
    writes.push(job.insert)
  }
  if (estimate && mapped.email) {
    const emailOut = estimateEmail(settings, estimate, mapped.email, mapped.firstName)
    const job = enqueueJob(db, {
      kind: 'estimate_email',
      dedupeKey: `estimate_email:${submissionId}`,
      payload: emailOut,
      envelope: { to: [mapped.email], subject: emailOut.subject },
    })
    jobIds.push(job.id)
    writes.push(job.insert)
  }
  // Fenced: when our claim no longer holds (it expired and another processor took over), the state CASE yields
  // a value the CHECK refuses and the whole batch (Lead, activity, consent, jobs) rolls back; the caller then
  // answers whatever the other processor stored.
  writes.push(
    db
      .update(submissionProcessing)
      .set({
        state: sql`case when ${submissionProcessing.state} = 'processing' and ${submissionProcessing.claimedUntil} = ${token.getTime()} then 'processed' else 'claim_lost' end`,
        leadId,
        resultJson: JSON.stringify(body),
        claimedUntil: null,
        error: null,
        processedAt: now,
      })
      .where(eq(submissionProcessing.submissionId, submissionId)),
  )
  await db.batch(writes as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  return { status: 200, body, jobIds }
}

/** The address key of what `fillEmptyFields` leaves on a matched Lead (existing parts win). */
function mergedKey(existing: LeadMatch, f: LeadFields) {
  return addressKey({ street: existing.street ?? f.street, zip: existing.zip ?? f.zip })
}

/**
 * The Homeowner's answers, one `key: value` per line, for the `form` activity. Estimator answers are left out: the
 * Estimate snapshot holds them, so the activity gets the range instead.
 */
function activitySummary(p: Record<string, unknown>, estimate?: PricedEstimate): string {
  const lines = Object.keys(p)
    .filter((k) => !NOT_BUSINESS_KEYS.has(k) && !ESTIMATOR_KEYS.has(k) && k !== 'website')
    .flatMap((k) => {
      const v = p[k]
      if (v === null || v === undefined || v === '') return []
      return [`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`]
    })
  const priced = estimate
    ? [`estimate: ${usd(estimate.result.low)} to ${usd(estimate.result.high)} (Published version ${estimate.version})`]
    : []
  return [`Website form (${trimmedNonEmptyString(p.source) ?? 'unknown'})`, ...priced, ...lines].join('\n').slice(0, 8000)
}

const ESTIMATOR_KEYS = new Set(['answers', 'defaulted', 'estimator_version'])

type LeadMatch = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
}

/** Dedupe: the Lead with this phone (A) and the Lead with this email, which may be another Lead (B). */
async function findLeads(db: Db, f: LeadFields): Promise<{ byPhone?: LeadMatch; byEmail?: LeadMatch }> {
  const cols = {
    id: leads.id,
    firstName: leads.firstName,
    lastName: leads.lastName,
    email: leads.email,
    street: leads.street,
    city: leads.city,
    state: leads.state,
    zip: leads.zip,
  }
  const [byPhone, byEmail] = await Promise.all([
    f.phoneE164 ? db.select(cols).from(leads).where(eq(leads.phoneE164, f.phoneE164)).get() : undefined,
    f.emailLower ? db.select(cols).from(leads).where(eq(leads.emailLower, f.emailLower)).get() : undefined,
  ])
  return { byPhone, byEmail }
}

/** The submitted phone or email that did not match the Lead it attached to, worded for a note; null when none. */
function newContactOf(f: LeadFields, { byPhone, byEmail }: { byPhone?: LeadMatch; byEmail?: LeadMatch }): string | null {
  if (byPhone && !byEmail && f.email) return `email ${f.email}`
  if (byEmail && !byPhone && f.phoneE164) return `phone ${f.phoneE164}`
  return null
}

/**
 * Public input on a matched Lead: fill empty non-identity fields. Never touches phone,
 * email (plan 010 F4), stage, assignment, source, first_source, or anything else already set.
 */
function fillEmptyFields(db: Db, leadId: string, f: LeadFields, o: { existing: LeadMatch; needsReview: boolean }) {
  const fill = (col: AnyColumn, value: string | number | null) => sql`coalesce(${col}, ${value})`
  // The address is filled only while it is still the one read (fenced in this statement), and its key is then
  // recomputed from that merged address, so the stored key always matches the persisted address parts.
  const e = o.existing
  const unchanged = sql`(${leads.street} is ${e.street} and ${leads.city} is ${e.city} and ${leads.state} is ${e.state} and ${leads.zip} is ${e.zip})`
  const fillAddress = (col: AnyColumn, value: string | null) => sql`case when ${unchanged} then coalesce(${col}, ${value}) else ${col} end`
  return db
    .update(leads)
    .set({
      firstName: fill(leads.firstName, f.firstName),
      lastName: fill(leads.lastName, f.lastName),
      street: fillAddress(leads.street, f.street),
      city: fillAddress(leads.city, f.city),
      state: fillAddress(leads.state, f.state),
      zip: fillAddress(leads.zip, f.zip),
      // Plan 006 D3: the key of the address this write leaves.
      addressKey: sql`case when ${unchanged} then ${mergedKey(e, f)} else ${leads.addressKey} end`,
      serviceType: fill(leads.serviceType, f.serviceType),
      message: fill(leads.message, f.message),
      ...(o.needsReview ? { needsReview: true } : {}),
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId))
}

function conflictNote(f: LeadFields, other: LeadMatch): string {
  const name = [other.firstName, other.lastName].filter(Boolean).join(' ') || 'unnamed'
  return [
    `Possible duplicate: this Form submission's phone ${f.phoneE164} matched this Lead, but its email ${f.email} belongs to Lead ${name} (${other.id}).`,
    'Neither Lead was given the other’s phone or email. Check both and merge by hand if they are the same Homeowner.',
  ].join('\n')
}

/**
 * Explicit field map from the site's JSON to Lead columns. Null = not a Lead. Turner's forms (FLW-201) send
 * `first_name`/`last_name`, a separate `zip`, `project_type` and `notes`; the ported single `name`, `projectType`
 * and `message` are still read.
 */
export function mapSitePayload(p: Record<string, unknown>): LeadFields | null {
  const given = trimmedNonEmptyString(p.first_name)
  const [splitFirst, ...rest] = (trimmedNonEmptyString(p.name) ?? '').split(/\s+/)
  const firstName = given?.slice(0, 60) ?? splitFirst
  const lastName = given ? (trimmedNonEmptyString(p.last_name)?.slice(0, 60) ?? null) : rest.join(' ') || null
  const email = validEmail(trimmedNonEmptyString(p.email))
  const phone = trimmedNonEmptyString(p.phone)
  const phoneE164 = toE164(phone)
  if (!firstName || (!email && !phoneE164)) return null
  const address = splitAddress(trimmedNonEmptyString(p.address))
  const zip = trimmedNonEmptyString(p.zip)
  return {
    firstName,
    lastName,
    email,
    emailLower: email?.toLowerCase() ?? null,
    phone,
    phoneE164,
    ...address,
    zip: address.zip ?? (zip && /^\d{5}$/.test(zip) ? zip : null),
    serviceType: trimmedNonEmptyString(p.projectType) ?? trimmedNonEmptyString(p.project_type),
    message: trimmedNonEmptyString(p.message) ?? trimmedNonEmptyString(p.notes),
  }
}

/**
 * Pragmatic syntax check (local@domain.tld, no spaces). Invalid -> null; the raw value stays in the Form submission.
 * Plan 010 F2: length-capped and the domain labels exclude dots, so the regex cannot backtrack quadratically.
 */
export function validEmail(raw: string | null): string | null {
  return raw && raw.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(raw) ? raw : null
}

export { toE164 }

/** "12 Main St, Douglassville, PA 19518" -> parts; anything else stays whole in `street`. */
export function splitAddress(address: string | null) {
  // Plan 010 F3: capped, and the city group cannot start with whitespace, so `\s*` and it never split the same run.
  if (address && address.length > 300) return { street: address.slice(0, 300), city: null, state: null, zip: null }
  const m = address?.match(/^(.+?),\s*([^,\s][^,]*?),\s*([A-Za-z]{2})\.?(?:\s+(\d{5}(?:-\d{4})?))?$/)
  if (!m) return { street: address, city: null, state: null, zip: null }
  return { street: m[1], city: m[2], state: m[3].toUpperCase(), zip: m[4] ?? null }
}

function attribution(p: Record<string, unknown>): string | null {
  const out = Object.fromEntries(ATTRIBUTION_KEYS.flatMap((k) => (trimmedNonEmptyString(p[k]) ? [[k, trimmedNonEmptyString(p[k])]] : [])))
  return Object.keys(out).length ? JSON.stringify(out) : null
}

function firstTouch(p: Record<string, unknown>): string | null {
  const ft = typeof p.first_touch === 'string' ? parseJsonObject(p.first_touch) : null
  return ft && Object.keys(ft).length ? JSON.stringify(ft) : null
}

// Keys that are not the Homeowner's answers: they may differ between retries of one logical submission.
const NOT_BUSINESS_KEYS = new Set<string>([
  ...ATTRIBUTION_KEYS,
  'first_touch',
  'turnstile_token',
  'submission_key',
  'submission_timestamp',
  'access_key',
  'subject',
  'from_name',
  'leadScore',
  'leadGrade',
  'leadPriority',
  'leadScoreBreakdown',
])

/** Canonical JSON of the business fields (sorted keys; no token, key, timestamps or attribution). */
function canonicalBusinessFields(p: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(p)
      .filter((k) => !NOT_BUSINESS_KEYS.has(k))
      .sort()
      .map((k) => [k, p[k]]),
  )
}

// The client's logical-submission key (UUID); without one every post is its own submission.
function clientSubmissionKey(p: Record<string, unknown> | null): string | null {
  const k = p ? trimmedNonEmptyString(p.submission_key) : null
  return k && k.length <= 100 ? k : null
}

/** Reads at most `max` bytes; null (and the stream cancelled) as soon as the body is larger. */
export async function readBoundedText(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'))
  if (declared > max) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function allowedOrigins(env: IntakeEnv): string[] {
  return (env.INTAKE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => URL.canParse(o))
}

function trimmedNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function isUniqueViolation(err: unknown): boolean {
  return /UNIQUE constraint failed/.test(String((err as { cause?: unknown })?.cause ?? err) + String(err))
}

async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function reject(status: number, error: string): IntakeResult {
  return { status, body: { ok: false, success: false, error, message: error } }
}
