import { eq, sql } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { emailTemplates, leadActivity, leads } from '#/db/schema'
import { EMAIL_TEMPLATES } from '#/lib/email-templates'
import { renderTemplate } from '#/lib/estimator/email-template'
import { badRequest, optionalText } from '#/lib/input'
import { leadNotFound } from '#/lib/leads.server'
import { type OutboxEnv, enqueueJob, kickJobs } from '#/lib/outbox'
import { readCompanySettings } from '#/lib/settings.server'
import { stageMove } from '#/lib/stage-history.server'

// Moving a Lead to Lost from the board or the Lead page opens the Lost window (src/components/LostDialog.tsx). It asks:
// - send the "Lost: thank-you" email (Customer email template, Settings) to the Homeowner, or not,
// - mark the Lead Do not contact (on by default: a Homeowner who told us no is left out of marketing),
// - an optional reason, kept on the stage history.
// The move, the flag, a note on the activity and the email job are one D1 batch. The email is rendered and frozen when
// queued and goes out at once. At send time the job checks the Lead is still Lost, so moving it back first sends nothing.
// It does not check Do not contact: the flag set in the same window is about marketing, and this email is a direct
// reply to a Homeowner who just wrote to us. A Lead that was already Do not contact before the move cannot be sent it.
// ponytail: the MCP move_lead_stage tool still moves to Lost without the window (no email, flag untouched); add
// sendEmail/doNotContact to it if Claude should close Leads this way too.

type Db = ReturnType<typeof getDb>

export const LOST_JOB_KIND = 'lost_email'

const plainFirstName = (n: string | null) => (n && /^[A-Za-z][A-Za-z'-]{0,39}$/.test(n) ? n : 'there')

async function lostEmailFor(db: Db, env: OutboxEnv, lead: { firstName: string | null }) {
  const [row, settings] = await Promise.all([
    db.select({ template: emailTemplates.template }).from(emailTemplates).where(eq(emailTemplates.key, 'lost_thank_you')).get(),
    readCompanySettings(env.DB),
  ])
  const template = row?.template ?? EMAIL_TEMPLATES.find((t) => t.key === 'lost_thank_you')!.defaultTemplate
  const { subject, body } = renderTemplate(template, {
    first_name: plainFirstName(lead.firstName),
    company_name: settings.name,
    company_phone: settings.phone ?? '',
  })
  return { subject, body, replyTo: settings.email ?? null }
}

/** What the Lost window shows: the email as it would go out, and whether it can be sent. */
export async function previewLost(db: Db, env: OutboxEnv, leadId: string) {
  const lead = await db.select().from(leads).where(eq(leads.id, leadId)).get()
  if (!lead) throw leadNotFound()
  const { subject, body } = await lostEmailFor(db, env, lead)
  const cannotSend = !lead.email ? 'This Lead has no email address.' : lead.doNotContact ? 'This Lead is already marked Do not contact.' : null
  return { leadId, to: lead.email, subject, body, cannotSend, doNotContact: lead.doNotContact, stage: lead.stage }
}

export type MarkLostInput = { leadId: string; sendEmail: boolean; doNotContact: boolean; reason?: string | null }

/** Moves the Lead to Lost, sets Do not contact as chosen, and queues the thank-you email when asked. */
export async function markLost(db: Db, env: OutboxEnv, input: MarkLostInput, staffId: string | null, now = Date.now()) {
  const { leadId, sendEmail, doNotContact } = input
  const reason = optionalText(input.reason ?? null, 200)
  const lead = await db.select().from(leads).where(eq(leads.id, leadId)).get()
  if (!lead) throw leadNotFound()
  if (sendEmail && !lead.email) throw badRequest('This Lead has no email address.')
  if (sendEmail && lead.doNotContact) throw badRequest('This Lead was already marked Do not contact, so the email cannot be sent.')

  const job = sendEmail
    ? await (async () => {
        const { subject, body, replyTo } = await lostEmailFor(db, env, lead)
        const to = [lead.email!]
        return enqueueJob(db, {
          kind: LOST_JOB_KIND,
          dedupeKey: `lost:${leadId}:${now}`,
          payload: { lead_id: leadId, to, subject, text: body, ...(replyTo ? { replyTo } : {}) },
          envelope: { to, subject },
        })
      })()
    : null

  const summary = [
    'Marked Lost.',
    reason ? `Reason: ${reason}.` : null,
    sendEmail ? `Thank-you email sent to ${lead.email}.` : 'No email sent.',
    doNotContact ? 'Marked Do not contact.' : lead.doNotContact ? 'Do not contact cleared.' : null,
  ]
    .filter(Boolean)
    .join(' ')

  await db.batch([
    stageMove(db, 'lost', sql`${leads.id} = ${leadId}`, { at: now, by: staffId, reason }),
    db.update(leads).set({ stage: 'lost', doNotContact, updatedAt: new Date(now) }).where(eq(leads.id, leadId)),
    db.insert(leadActivity).values({ id: crypto.randomUUID(), leadId, kind: 'note', body: summary, authorId: staffId, createdAt: new Date(now) }),
    ...(job ? [job.insert] : []),
  ] as unknown as Parameters<Db['batch']>[0])

  if (job) kickJobs(env, [job.id])
  return { id: leadId, stage: 'lost' as const, doNotContact, emailQueued: Boolean(job) }
}

/** Send-time guard for the thank-you: the Lead still exists and is still Lost. */
export async function stillLost(db: Db, p: { lead_id?: string }) {
  if (!p.lead_id) return false
  const lead = await db.select({ stage: leads.stage }).from(leads).where(eq(leads.id, p.lead_id)).get()
  return lead?.stage === 'lost'
}
