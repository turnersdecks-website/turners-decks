import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { consentEvents, emailTemplates, leadActivity, leads, notificationJobs } from '#/db/schema'
import { renderTemplate } from '#/lib/estimator/email-template'
import { EMAIL_TEMPLATES, type TemplateKey } from '#/lib/email-templates'
import { badRequest } from '#/lib/input'
import { leadNotFound } from '#/lib/leads.server'
import { type OutboxEnv, enqueueJob, kickJobs } from '#/lib/outbox'
import { readCompanySettings } from '#/lib/settings.server'
import { stageMove } from '#/lib/stage-history.server'

// Appointments (the free consultation). Booking one on a Lead:
// - stores leads.appointment_at and moves a New or Contacted Lead to Appointment,
// - sends the confirmation now (email from the "Appointment confirmation" template, and/or a text from the Quo number),
// - queues the reminder (email from the "Appointment reminder" template, and/or a text) for REMINDER_BEFORE_MS ahead.
// All of these are outbox jobs; the reminder is a job whose next_attempt_at is the reminder time, so the 5-minute
// cron sends it. Changing or cancelling the appointment cancels every unsent appointment job for the Lead (state
// dead, outcome cancelled) and, for a change, queues a fresh set. At send time each job checks the Lead still has
// that same appointment and is not Do not contact, so a stale job sends nothing.
// Texts: appointment texts are about the Homeowner's own project. The Homeowner needs a text consent grant; when
// Staff tick "text" and there is none, booking records one (source staff), because they gave us the number to set
// this visit up. A STOP (revoke) is never overridden: booking with "text" then fails.

type Db = ReturnType<typeof getDb>

/** The reminder goes out this long before the appointment. */
export const REMINDER_BEFORE_MS = 24 * 60 * 60_000
/** A reminder that would go out sooner than this after booking is skipped: the confirmation covers it. */
const REMINDER_MIN_LEAD_MS = 2 * 60 * 60_000

export const APPOINTMENT_JOB_KINDS = ['appointment_email', 'appointment_text'] as const

export type BookAppointmentInput = { leadId: string; at: number; sendEmail: boolean; sendText: boolean }

type Vars = Record<string, string>

const plainFirstName = (n: string | null) => (n && /^[A-Za-z][A-Za-z'-]{0,39}$/.test(n) ? n : 'there')

/** "Saturday, November 28" and "10:00 AM" in the company time zone. */
export function appointmentWhen(at: number, timeZone: string) {
  const d = new Date(at)
  return {
    date: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(d),
    time: new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(d),
  }
}

/** The plain-words texts (no template editor yet). Signed, with the opt-out line. */
export function appointmentText(which: 'confirmation' | 'reminder', v: Vars) {
  const where = v.address ? ` at ${v.address}` : ''
  return which === 'confirmation'
    ? `Hi ${v.first_name}, this is ${v.company_name}. You're all set for your free consultation on ${v.appointment_date} at ${v.appointment_time}${where}. Need to change it? Call or text us here. Reply STOP to opt out.`
    : `Hi ${v.first_name}, a reminder from ${v.company_name}: we'll see you tomorrow, ${v.appointment_date}, at ${v.appointment_time}${where}. Need to change it? Call or text us here. Reply STOP to opt out.`
}

async function templateFor(db: Db, key: TemplateKey) {
  const row = await db.select({ template: emailTemplates.template }).from(emailTemplates).where(eq(emailTemplates.key, key)).get()
  return row?.template ?? EMAIL_TEMPLATES.find((t) => t.key === key)!.defaultTemplate
}

/** Every unsent appointment job of the Lead becomes cancelled (never sent). Goes in the booking's D1 batch. */
function cancelUnsent(db: Db, leadId: string, why: string) {
  return db
    .update(notificationJobs)
    .set({ state: 'dead', outcome: 'cancelled', lastError: why, claimedUntil: null })
    .where(
      and(
        inArray(notificationJobs.kind, [...APPOINTMENT_JOB_KINDS]),
        inArray(notificationJobs.state, ['pending', 'failed']),
        sql`json_extract(${notificationJobs.payloadJson}, '$.lead_id') = ${leadId}`,
      ),
    )
}

function note(db: Db, leadId: string, body: string, staffId: string | null, now: number) {
  return db.insert(leadActivity).values({ id: crypto.randomUUID(), leadId, kind: 'appointment', body, authorId: staffId, createdAt: new Date(now) })
}

/** Books (or moves) the Lead's appointment and queues its confirmation and reminder. */
export async function bookAppointment(db: Db, env: OutboxEnv, input: BookAppointmentInput, staffId: string | null, now = Date.now()) {
  const { leadId, at, sendEmail, sendText } = input
  if (!Number.isFinite(at)) throw badRequest('Pick a date and time for the appointment.')
  if (at <= now) throw badRequest('The appointment time has already passed.')
  if (at > now + 400 * 24 * 60 * 60_000) throw badRequest('The appointment is more than a year away.')
  const lead = await db.select().from(leads).where(eq(leads.id, leadId)).get()
  if (!lead) throw leadNotFound()
  if ((sendEmail || sendText) && lead.doNotContact) throw badRequest('This Lead is marked Do not contact, so nothing can be sent.')
  if (sendEmail && !lead.email) throw badRequest('This Lead has no email address.')
  if (sendText && !lead.phoneE164) throw badRequest('This Lead has no mobile number.')
  let addConsent = false
  if (sendText) {
    const last = await db
      .select({ event: consentEvents.event })
      .from(consentEvents)
      .where(and(eq(consentEvents.phoneE164, lead.phoneE164!), eq(consentEvents.program, 'sms_followup')))
      .orderBy(desc(consentEvents.occurredAt), desc(consentEvents.recordedAt))
      .get()
    if (last?.event === 'revoke') throw badRequest('This number texted STOP, so we cannot text it. Send the email only.')
    addConsent = last?.event !== 'grant'
  }

  const settings = await readCompanySettings(env.DB)
  const when = appointmentWhen(at, settings.timezone)
  const vars: Vars = {
    first_name: plainFirstName(lead.firstName),
    appointment_date: when.date,
    appointment_time: when.time,
    address: [lead.street, lead.city].filter(Boolean).join(', '),
    company_name: settings.name,
    company_phone: settings.phone ?? '',
  }
  const reminderAt = at - REMINDER_BEFORE_MS
  const withReminder = reminderAt >= now + REMINDER_MIN_LEAD_MS

  type Planned = { kind: (typeof APPOINTMENT_JOB_KINDS)[number]; which: 'confirmation' | 'reminder'; payload: Record<string, unknown>; envelope?: { to: string[]; subject: string }; notBefore?: Date }
  const planned: Planned[] = []
  for (const which of ['confirmation', 'reminder'] as const) {
    if (which === 'reminder' && !withReminder) continue
    const notBefore = which === 'reminder' ? new Date(reminderAt) : undefined
    if (sendEmail) {
      const { subject, body } = renderTemplate(await templateFor(db, which === 'confirmation' ? 'appointment_confirmation' : 'appointment_reminder'), vars)
      const to = [lead.email!]
      planned.push({
        kind: 'appointment_email',
        which,
        payload: { lead_id: leadId, at, which, to, subject, text: body, ...(settings.email ? { replyTo: settings.email } : {}) },
        envelope: { to, subject },
        notBefore,
      })
    }
    if (sendText) planned.push({ kind: 'appointment_text', which, payload: { lead_id: leadId, at, which, to: lead.phoneE164!, content: appointmentText(which, vars) }, notBefore })
  }
  const jobs = planned.map((p) => ({ ...p, job: enqueueJob(db, { kind: p.kind, dedupeKey: `appt:${leadId}:${at}:${p.kind}:${p.which}:${now}`, payload: p.payload, envelope: p.envelope, notBefore: p.notBefore }) }))

  const moving = lead.appointmentAt !== null
  const earlyStage = sql`${leads.id} = ${leadId} AND ${leads.stage} IN ('new', 'contacted')`
  const sends = [sendEmail && 'email', sendText && 'text'].filter(Boolean).join(' and ')
  const summary = `${moving ? 'Appointment moved to' : 'Appointment booked for'} ${when.date} at ${when.time}.${
    sends ? ` Confirmation ${sends} sent now${withReminder ? `, reminder ${appointmentWhen(reminderAt, settings.timezone).date} at ${appointmentWhen(reminderAt, settings.timezone).time}` : ', no reminder (too soon)'}.` : ' Nothing sent to the Homeowner.'
  }`

  await db.batch([
    cancelUnsent(db, leadId, 'Appointment changed'),
    stageMove(db, 'appointment', earlyStage, { at: now, by: staffId, reason: 'Appointment booked' }),
    db.update(leads).set({ stage: sql`CASE WHEN ${leads.stage} IN ('new', 'contacted') THEN 'appointment' ELSE ${leads.stage} END`, appointmentAt: new Date(at), updatedAt: new Date(now) }).where(eq(leads.id, leadId)),
    ...(addConsent
      ? [
          db.insert(consentEvents).values({
            id: crypto.randomUUID(),
            phoneE164: lead.phoneE164!,
            program: 'sms_followup' as const,
            event: 'grant' as const,
            occurredAt: new Date(now),
            source: 'staff' as const,
            sourceRef: 'appointment',
            leadId,
            recordedAt: new Date(now),
          }),
        ]
      : []),
    note(db, leadId, summary, staffId, now),
    ...jobs.map((j) => j.job.insert),
  ] as unknown as Parameters<Db['batch']>[0])

  kickJobs(env, jobs.filter((j) => j.which === 'confirmation').map((j) => j.job.id))
  return { leadId, appointmentAt: new Date(at), reminderAt: withReminder ? new Date(reminderAt) : null, queued: jobs.map((j) => `${j.which} ${j.kind === 'appointment_email' ? 'email' : 'text'}`) }
}

/** Clears the appointment and cancels its unsent messages. Nothing is sent to the Homeowner. */
export async function cancelAppointment(db: Db, leadId: string, staffId: string | null, now = Date.now()) {
  const lead = await db.select({ at: leads.appointmentAt }).from(leads).where(eq(leads.id, leadId)).get()
  if (!lead) throw leadNotFound()
  if (!lead.at) return { leadId, appointmentAt: null }
  await db.batch([
    cancelUnsent(db, leadId, 'Appointment cancelled'),
    db.update(leads).set({ appointmentAt: null, updatedAt: new Date(now) }).where(eq(leads.id, leadId)),
    note(db, leadId, 'Appointment cancelled. Its reminder will not be sent.', staffId, now),
  ] as unknown as Parameters<Db['batch']>[0])
  return { leadId, appointmentAt: null }
}

/** The Lead's appointment messages (sent, waiting or cancelled), newest first, for the Lead page. */
export async function appointmentMessages(db: Db, leadId: string) {
  const rows = await db
    .select({ id: notificationJobs.id, kind: notificationJobs.kind, state: notificationJobs.state, outcome: notificationJobs.outcome, payload: notificationJobs.payloadJson, nextAttemptAt: notificationJobs.nextAttemptAt, sentAt: notificationJobs.sentAt, lastError: notificationJobs.lastError, createdAt: notificationJobs.createdAt })
    .from(notificationJobs)
    .where(and(inArray(notificationJobs.kind, [...APPOINTMENT_JOB_KINDS]), sql`json_extract(${notificationJobs.payloadJson}, '$.lead_id') = ${leadId}`))
    .orderBy(desc(notificationJobs.createdAt))
    .limit(20)
  return rows.map(({ payload, ...r }) => {
    const p = JSON.parse(payload) as { which?: string; at?: number }
    return { ...r, channel: r.kind === 'appointment_email' ? 'email' : 'text', which: p.which ?? 'confirmation', appointmentAt: p.at ? new Date(p.at) : null }
  })
}

/** Send-time guard for appointment jobs: the Lead still has this appointment and may be contacted. */
export async function appointmentStillOn(db: Db, p: { lead_id?: string; at?: number }) {
  if (!p.lead_id || !p.at) return false
  const lead = await db.select({ at: leads.appointmentAt, dnc: leads.doNotContact }).from(leads).where(eq(leads.id, p.lead_id)).get()
  return Boolean(lead && !lead.dnc && lead.at?.getTime() === p.at)
}
