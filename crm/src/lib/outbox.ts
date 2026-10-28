import { waitUntil } from 'cloudflare:workers'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { getDb } from '#/db/client'
import { notificationJobs } from '#/db/schema'
import { type Email, type SendEmail, redactEmail } from '#/lib/email'
import { JOB_KINDS, type JobKindContext } from '#/lib/outbox-kinds'

// Notification outbox (PLAN.md > Architecture (Email), ADR 0004). A request commits its data and jobs in one D1
// batch (`enqueueJob`), then tries the first send right away (`dispatchJob` via `ctx.waitUntil`). The 5-minute
// cron (`dispatchDueJobs`) re-claims pending, expired-claimed and failed jobs. Claims are atomic leases: only
// the caller whose UPDATE changed the row sends. Resend gets the job id as its idempotency key.

export type OutboxEnv = { DB: D1Database; BETTER_AUTH_URL: string; RESEND_API_KEY?: string; EMAIL_FROM?: string }
export type DispatchDeps = { fetch?: typeof globalThis.fetch; now?: () => number }
type Db = ReturnType<typeof getDb>

export const DEFAULT_FROM = 'Turner’s Decks <notifications@send.turnersdecks.com>'
const RESEND_URL = 'https://api.resend.com/emails'
const SEND_TIMEOUT_MS = 10_000
const LEASE_MS = 2 * 60_000
const MAX_ATTEMPTS = 6
const BACKOFF_BASE_MS = 2 * 60_000 // 2, 4, 8, 16, 32 min between attempts
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60_000
// One Resend call per job; Workers Free allows 50 outside calls per invocation.
const SWEEP_LIMIT = 40

/**
 * How a job ended, reported to its kind's `onOutcome` hook:
 * - `accepted`: Resend took it; `resendId` is Resend's email id.
 * - `failed`: definitely not sent (Resend refused it, or there was nothing to send). Not retried.
 * - `dead`: gave up after retries or past Resend's 24-hour idempotency window. It may or may not have been
 *   delivered, so it is never auto-resent; Staff decide.
 */
export type JobOutcome =
  | { type: 'accepted'; resendId: string | null }
  | { type: 'failed'; error: string }
  | { type: 'dead'; error: string }

/** A job row as handed to kind hooks. */
export type Job = typeof notificationJobs.$inferSelect

/** Who a business email goes to and its subject, frozen at enqueue: stored on the job and sent as-is. */
export type Envelope = { to: string[]; subject: string }

/**
 * Builds the insert for one job; put `insert` in the same D1 batch as the data it is about. A repeated dedupe_key is
 * a no-op, unless `failOnDuplicate`: then the insert fails and rolls the whole batch back (the caller looks up the
 * existing job by dedupe_key). Business kinds pass their frozen `envelope` ("Emails sent", plan 006 S11): it is
 * stored as recipient/subject, and the kind's render must send those same values. Authentication kinds pass none.
 */
export function enqueueJob(
  db: Db,
  {
    kind,
    dedupeKey,
    payload,
    envelope,
    failOnDuplicate = false,
  }: { kind: string; dedupeKey: string; payload: unknown; envelope?: Envelope; failOnDuplicate?: boolean },
) {
  const id = crypto.randomUUID()
  const now = new Date()
  const values = {
    id,
    kind,
    payloadJson: JSON.stringify(payload),
    dedupeKey,
    state: 'pending' as const,
    nextAttemptAt: now,
    createdAt: now,
    ...(envelope ? { recipient: envelope.to.join(', ') || null, subject: envelope.subject } : {}),
  }
  const insert = failOnDuplicate ? db.insert(notificationJobs).values(values) : db.insert(notificationJobs).values(values).onConflictDoNothing()
  return { id, insert }
}

/**
 * The first send attempt for jobs a request just committed, after the response (`ctx.waitUntil`). If the Worker
 * is gone before it finishes, the cron picks the jobs up.
 */
export function kickJobs(env: OutboxEnv, jobIds: string[], deps: DispatchDeps = {}) {
  const run = Promise.all(jobIds.map((id) => dispatchJob(env, id, deps)))
  try {
    waitUntil(run)
  } catch {
    // Outside a request (tests, scripts) there is no waitUntil; the promise still runs.
  }
}

/** SendEmail for one-off emails (password reset): enqueue as a `kind` job whose payload is the email, then kick it. */
export function outboxSendEmail(env: OutboxEnv, kind: string, deps: DispatchDeps = {}): SendEmail {
  return async (email) => {
    const job = enqueueJob(getDb(env.DB), { kind, dedupeKey: `${kind}:${crypto.randomUUID()}`, payload: email })
    await job.insert
    kickJobs(env, [job.id], deps)
  }
}

/**
 * Claims one job and sends it if this caller won the lease. Never throws. Without RESEND_API_KEY nothing is
 * claimed or sent (a redacted warning is logged), so jobs wait and go out once the key exists.
 */
export async function dispatchJob(env: OutboxEnv, jobId: string, deps: DispatchDeps = {}): Promise<void> {
  if (!env.RESEND_API_KEY) return log('warn', 'email not sent: RESEND_API_KEY is not set', { job_id: jobId })
  const now = deps.now?.() ?? Date.now()
  const db = getDb(env.DB)
  try {
    const job = await claim(db, jobId, now)
    if (job) await sendClaimed({ db, env }, job, now, deps.fetch ?? globalThis.fetch)
  } catch (err) {
    log('error', 'email job dispatch error', { job_id: jobId, error: redactText(String(err)) })
  }
}

/** The cron's sweep: every job that is due (pending, failed past its backoff, or claimed with an expired lease). */
export async function dispatchDueJobs(env: OutboxEnv, deps: DispatchDeps = {}): Promise<void> {
  const now = deps.now?.() ?? Date.now()
  const db = getDb(env.DB)
  const due = await db
    .select({ id: notificationJobs.id })
    .from(notificationJobs)
    .where(dueAt(now))
    .orderBy(asc(notificationJobs.nextAttemptAt))
    .limit(SWEEP_LIMIT)
  if (!due.length) return
  if (!env.RESEND_API_KEY) return log('warn', 'email not sent: RESEND_API_KEY is not set', { due_jobs: due.length })
  // Each claim reads the clock itself: a lease from the sweep's start would already be spent after slow sends.
  for (const { id } of due) await dispatchJob(env, id, deps)
}

/** The atomic lease: only one caller sees the row change. */
async function claim(db: Db, jobId: string, now: number): Promise<Job | undefined> {
  const [job] = await db
    .update(notificationJobs)
    .set({
      state: 'claimed',
      claimedUntil: new Date(now + LEASE_MS),
      attempts: sql`${notificationJobs.attempts} + 1`,
      firstAttemptAt: sql`coalesce(${notificationJobs.firstAttemptAt}, ${now})`,
    })
    .where(and(eq(notificationJobs.id, jobId), dueAt(now)))
    .returning()
  return job
}

const dueAt = (now: number) =>
  sql`((${notificationJobs.state} in ('pending', 'failed') and coalesce(${notificationJobs.nextAttemptAt}, 0) <= ${now})
    or (${notificationJobs.state} = 'claimed' and ${notificationJobs.claimedUntil} < ${now}))`

/** Our lease still holds: nobody re-claimed the job after it expired. */
const leaseHeld = (job: Job) =>
  and(eq(notificationJobs.id, job.id), eq(notificationJobs.state, 'claimed'), eq(notificationJobs.claimedUntil, job.claimedUntil!))

async function sendClaimed(ctx: JobKindContext, job: Job, now: number, fetch: typeof globalThis.fetch) {
  // A resend after Resend's 24-hour idempotency window could duplicate an email that did go out.
  if (job.attempts > 1 && now - (job.firstAttemptAt?.getTime() ?? now) > IDEMPOTENCY_WINDOW_MS) {
    return finish(ctx, job, now, { type: 'dead', error: 'unresolved after 24 h (Resend idempotency window); re-send by hand' })
  }
  // An expired claim past the limit: the Worker died during the last allowed attempt. Never send again.
  if (job.attempts > MAX_ATTEMPTS) {
    return finish(ctx, job, now, { type: 'dead', error: `unresolved after the last attempt (${MAX_ATTEMPTS}); re-send by hand` })
  }
  const kind = JOB_KINDS[job.kind]
  if (!kind) return finish(ctx, job, now, { type: 'failed', error: `unknown job kind ${job.kind}` })

  let email: Email | null = null
  let result: SendResult
  try {
    email = await kind.render(JSON.parse(job.payloadJson), ctx)
    if (!email) return finish(ctx, job, now, { type: 'failed', error: 'nothing to send (no recipient)' })
    result = await sendViaResend(ctx.env, job.id, email, fetch)
  } catch (err) {
    result = { ok: false, definite: false, error: String(err), status: null }
  }
  const to = email ? recipients(email).map(redactEmail).join(', ') : undefined
  if (result.ok) return finish(ctx, job, now, { type: 'accepted', resendId: result.id }, to)
  const error = redactText(result.error).slice(0, 500)
  if (result.definite) return finish(ctx, job, now, { type: 'failed', error }, to)
  if (job.attempts >= MAX_ATTEMPTS) return finish(ctx, job, now, { type: 'dead', error }, to)

  const nextAttemptAt = new Date(now + BACKOFF_BASE_MS * 2 ** (job.attempts - 1))
  await ctx.db
    .update(notificationJobs)
    .set({ state: 'failed', claimedUntil: null, lastError: error, nextAttemptAt })
    .where(leaseHeld(job))
  log('warn', 'email job will retry', {
    job_id: job.id,
    kind: job.kind,
    attempts: job.attempts,
    status: result.status,
    to,
    error,
    next_attempt_at: nextAttemptAt.toISOString(),
  })
}

/**
 * Records how a job ended (only while our lease holds) and logs it. The kind's hook writes go in the same D1 batch,
 * fenced on the lease, so the job's terminal state and the kind's records (activity outcome, stage) commit together
 * or not at all: an interrupted finish leaves the job claimed, and the cron retries it once the lease expires.
 */
async function finish(ctx: JobKindContext, job: Job, now: number, outcome: JobOutcome, to?: string) {
  const kind = JOB_KINDS[job.kind]
  let hookWrites: BatchItem<'sqlite'>[] = []
  try {
    hookWrites = kind?.onOutcome?.(outcome, job, ctx, sql`exists (select 1 from ${notificationJobs} where ${leaseHeld(job)})`) ?? []
  } catch (err) {
    log('error', 'email job outcome hook failed', { job_id: job.id, kind: job.kind, error: redactText(String(err)) })
  }
  const jobWrite = ctx.db
    .update(notificationJobs)
    .set({
      ...(outcome.type === 'accepted'
        ? { state: 'sent' as const, sentAt: new Date(now), providerMessageId: outcome.resendId, lastError: null }
        : { state: 'dead' as const, lastError: outcome.error }),
      outcome: outcome.type,
      claimedUntil: null,
      ...(kind?.sensitive ? { payloadJson: '{}' } : {}),
    })
    .where(leaseHeld(job))
  // Hook writes first: their fence reads the lease before the job write releases it.
  const results = await ctx.db.batch([...hookWrites, jobWrite] as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  if ((results.at(-1) as D1Result).meta.changes !== 1)
    return log('warn', 'email job lease lost before it finished', { job_id: job.id, kind: job.kind })
  log(outcome.type === 'accepted' ? 'info' : 'error', `email job ${outcome.type}`, {
    job_id: job.id,
    kind: job.kind,
    attempts: job.attempts,
    to,
    ...(outcome.type === 'accepted' ? { resend_id: outcome.resendId } : { error: outcome.error }),
  })
}

type SendResult = { ok: true; id: string | null } | { ok: false; definite: boolean; error: string; status: number | null }

async function sendViaResend(env: OutboxEnv, jobId: string, email: Email, fetch: typeof globalThis.fetch): Promise<SendResult> {
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        'idempotency-key': jobId,
      },
      body: JSON.stringify({
        from: email.from ?? env.EMAIL_FROM ?? DEFAULT_FROM,
        to: recipients(email),
        subject: email.subject,
        text: email.text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        ...(email.cc?.length ? { cc: email.cc } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    const body = await res.json<{ id?: string; message?: string }>().catch(() => ({}) as { id?: string; message?: string })
    if (res.ok) return { ok: true, id: body.id ?? null }
    return { ok: false, definite: isDefiniteRefusal(res.status), error: `resend ${res.status}: ${body.message ?? ''}`, status: res.status }
  } catch (err) {
    return { ok: false, definite: false, error: String(err), status: null }
  }
}

const recipients = (email: Email) => (Array.isArray(email.to) ? email.to : [email.to])

/** Resend refused the request itself, so nothing was sent and repeating it will not help. */
function isDefiniteRefusal(status: number) {
  return status >= 400 && status < 500 && ![408, 409, 429].includes(status)
}

/** Structured, redacted log line (PLAN.md > Observability): never bodies, subjects or full addresses. */
function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown>) {
  console[level](JSON.stringify({ level, msg, ...fields }))
}

/** Replaces every email address in `text` with its redacted form (`d***@example.com`). */
export const redactText = (text: string) => text.replace(/[^\s@<>"',;:]+@[^\s@<>"',;:]+/g, (address) => redactEmail(address))
