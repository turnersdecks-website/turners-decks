import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { notificationJobs } from '#/db/schema'
import { badRequest } from '#/lib/input'
import { type OutboxEnv, kickJobs } from '#/lib/outbox'

// Settings > Message log: the emails and texts the CRM sent or tried to send (outbox jobs), newest first, with each
// one's error, so an admin can see what went wrong without the Worker logs. A failed one can be sent again (Retry)
// or put away (Dismiss: outcome dismissed, which the "failed for over an hour" banner ignores, like cancelled).

type Db = ReturnType<typeof getDb>

const LOG_DAYS = 30
export const QUIET_OUTCOMES = ['cancelled', 'dismissed'] as const

const KIND_LABELS: Record<string, string> = {
  owner_alert: 'New Lead alert',
  estimate_email: 'Estimate email',
  form_ack: 'Form thank-you',
  appointment_email: 'Appointment email',
  appointment_text: 'Appointment text',
  lost_email: 'Lost thank-you email',
  sms_lead_reply: 'Instant reply text',
  new_lead_text: 'New Lead heads-up text',
  photo_link_text: 'Photo link text',
  password_reset: 'Password reset',
}
const kindLabel = (k: string) => KIND_LABELS[k] ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export type MessageLogFilter = 'problems' | 'all'

/** A plain-words status: Sent, Waiting (with when), Retrying, Failed, Cancelled or Dismissed. */
function statusOf(j: { state: string; outcome: string | null }) {
  if (j.state === 'sent') return 'sent'
  if (j.outcome === 'cancelled') return 'cancelled'
  if (j.outcome === 'dismissed') return 'dismissed'
  if (j.state === 'dead') return 'failed'
  if (j.state === 'failed') return 'retrying'
  return 'waiting'
}

export async function listMessageLog(db: Db, filter: MessageLogFilter, now = Date.now()) {
  const since = new Date(now - LOG_DAYS * 24 * 60 * 60_000)
  const problems = and(inArray(notificationJobs.state, ['failed', 'dead']), sql`coalesce(${notificationJobs.outcome}, '') NOT IN ('cancelled', 'dismissed')`)
  const rows = await db
    .select()
    .from(notificationJobs)
    .where(and(gte(notificationJobs.createdAt, since), filter === 'problems' ? problems : undefined))
    .orderBy(desc(notificationJobs.createdAt))
    .limit(200)
  return rows.map((j) => {
    let p: { to?: string | string[]; subject?: string; content?: string; which?: string } = {}
    try {
      p = JSON.parse(j.payloadJson)
    } catch {}
    const to = Array.isArray(p.to) ? p.to.join(', ') : (p.to ?? '')
    const isText = j.kind.endsWith('_text') || j.kind.startsWith('sms_')
    return {
      id: j.id,
      kind: j.kind,
      label: `${kindLabel(j.kind)}${p.which === 'reminder' ? ' (reminder)' : p.which === 'confirmation' ? ' (confirmation)' : ''}`,
      channel: isText ? ('text' as const) : ('email' as const),
      to,
      summary: (p.subject ?? p.content ?? '').slice(0, 160),
      status: statusOf(j),
      error: j.lastError,
      attempts: j.attempts,
      createdAt: j.createdAt,
      sentAt: j.sentAt,
      nextAttemptAt: j.nextAttemptAt,
    }
  })
}

/** Sends a failed message again as a fresh attempt (attempt count and the 24-hour window start over). */
export async function retryMessage(db: Db, env: OutboxEnv, jobId: string, now = Date.now()) {
  const [job] = await db
    .update(notificationJobs)
    .set({ state: 'pending', outcome: null, attempts: 0, firstAttemptAt: null, nextAttemptAt: new Date(now), claimedUntil: null })
    .where(and(eq(notificationJobs.id, jobId), inArray(notificationJobs.state, ['failed', 'dead'])))
    .returning({ id: notificationJobs.id })
  if (!job) throw badRequest('Only a failed message can be sent again.')
  kickJobs(env, [job.id])
  return { id: job.id }
}

/** Puts a failed message away: it stays in the log as Dismissed and stops counting toward the banner. */
export async function dismissMessage(db: Db, jobId: string) {
  const [job] = await db
    .update(notificationJobs)
    .set({ state: 'dead', outcome: 'dismissed', claimedUntil: null })
    .where(and(eq(notificationJobs.id, jobId), inArray(notificationJobs.state, ['failed', 'dead'])))
    .returning({ id: notificationJobs.id })
  if (!job) throw badRequest('Only a failed message can be dismissed.')
  return { id: job.id }
}

/** Dismisses every failed message in the log at once (the banner's "clear all"). */
export async function dismissAllFailed(db: Db) {
  const rows = await db
    .update(notificationJobs)
    .set({ state: 'dead', outcome: 'dismissed', claimedUntil: null })
    .where(and(inArray(notificationJobs.state, ['failed', 'dead']), sql`coalesce(${notificationJobs.outcome}, '') NOT IN ('cancelled', 'dismissed')`))
    .returning({ id: notificationJobs.id })
  return { dismissed: rows.length }
}
