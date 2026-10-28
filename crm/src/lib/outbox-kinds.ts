import { type SQL, eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { getDb } from '#/db/client'
import { estimateSnapshots, formSubmissions, leads } from '#/db/schema'
import type { Email } from '#/lib/email'
import type { Envelope, Job, JobOutcome, OutboxEnv } from '#/lib/outbox'
import { type CompanySettings, parseOwnerAlertEmails, readCompanySettings } from '#/lib/settings.server'

// One entry per notification job kind (src/lib/outbox.ts). `render` builds the email at send time from the job's
// payload (null = nothing to send, reported as `failed`; a throw is retried). `onOutcome`, optional, hears how the
// job ended (accepted with Resend's email id / failed / dead) and returns the writes for the kind's own records, e.g.
// lead_activity. They run in the job's own finishing D1 batch and must include `fence` (true while the job's lease
// holds) in their WHERE, so they commit exactly when the job's terminal state does. `sensitive` payloads (reset
// links) are wiped once the job is finished.
export type JobKindContext = { db: ReturnType<typeof getDb>; env: OutboxEnv }
export type JobKind = {
  render: (payload: any, ctx: JobKindContext) => Promise<Email | null>
  onOutcome?: (outcome: JobOutcome, job: Job, ctx: JobKindContext, fence: SQL) => BatchItem<'sqlite'>[]
  sensitive?: boolean
}

// `to`/`subject`: the envelope frozen at enqueue (plan 006 S11), sent as-is. Absent on jobs queued before then.
type LeadJobPayload = { lead_id: string; submission_id: string; to?: string[]; subject?: string }
type LeadName = { firstName: string | null; lastName: string | null }

/** Owner alert envelope: every Owner alert address, else the company email. */
export function ownerAlertEnvelope(lead: LeadName, settings: Pick<CompanySettings, 'ownerAlertEmails' | 'email'>): Envelope {
  const owners = parseOwnerAlertEmails(settings.ownerAlertEmails) ?? []
  return { to: owners.length ? owners : settings.email ? [settings.email] : [], subject: `New Lead: ${fullName(lead) || 'a Homeowner'}` }
}

/** Acknowledgement envelope: the Homeowner's email. */
export function formAckEnvelope(lead: { email: string | null }, settings: Pick<CompanySettings, 'name'>): Envelope {
  return { to: lead.email ? [lead.email] : [], subject: `We received your request - ${settings.name}` }
}

/** The frozen envelope, or (legacy jobs) the one from today's data. */
const envelopeOf = (p: { to?: string[]; subject?: string }, live: () => Envelope): Envelope =>
  p.to && typeof p.subject === 'string' ? { to: p.to, subject: p.subject } : live()

export const JOB_KINDS: Record<string, JobKind> = {
  // Payload is the email itself (src/lib/email.ts > outboxSendEmail).
  password_reset: { render: async (p: Email) => (p?.to ? p : null), sensitive: true },
  // Account setup link for a newly added Staff member (Pine & Gable's Team screen, not in v1; src/lib/auth.ts keeps
  // the staffSetup path for it); same shape as a reset.
  staff_setup: { render: async (p: Email) => (p?.to ? p : null), sensitive: true },

  owner_alert: {
    async render(payload: LeadJobPayload, { db, env }) {
      const lead = await db.select().from(leads).where(eq(leads.id, payload.lead_id)).get()
      const settings = await readCompanySettings(env.DB)
      if (!lead) return null
      const { to, subject } = envelopeOf(payload, () => ownerAlertEnvelope(lead, settings))
      if (!to.length) return null
      const name = fullName(lead) || 'a Homeowner'
      const address = [lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
      // FLW-201: the estimate and timing this Form submission carried (the snapshot never changes after intake).
      const [snapshot, submission] = payload.submission_id
        ? await Promise.all([
            db.select().from(estimateSnapshots).where(eq(estimateSnapshots.submissionId, payload.submission_id)).get(),
            db.select({ rawBody: formSubmissions.rawBody }).from(formSubmissions).where(eq(formSubmissions.id, payload.submission_id)).get(),
          ])
        : [undefined, undefined]
      const raw = submission ? safeJson(submission.rawBody) : {}
      const flags = snapshot ? (JSON.parse(snapshot.flagsJson) as string[]) : []
      const lines = [
        `New Lead from the website: ${name}`,
        '',
        line('Phone', lead.phone),
        line('Email', lead.email),
        line('ZIP', lead.zip),
        line('Address', address),
        line('Service', lead.serviceType),
        snapshot ? `Estimate shown: ${usd(snapshot.low)} to ${usd(snapshot.high)} (Published version ${snapshot.version})` : null,
        snapshot ? `Needs site review: ${flags.length ? flags.join('; ') : 'No'}` : null,
        line('Timing', text(raw.timing)),
        line('Best way to reach', text(raw.contact_method)),
        raw.wants_financing === true ? 'Wants financing information: Yes' : null,
        line('Message', lead.message),
        '',
        `Open in the CRM: ${env.BETTER_AUTH_URL}/leads/${lead.id}`,
      ].filter((l) => l !== null)
      return { to, subject, text: lines.join('\n') }
    },
  },

  // FLW-201: rendered and frozen at intake (src/lib/intake-estimate.ts > estimateEmail); sent exactly as stored.
  estimate_email: { render: async (p: Email) => (p?.to ? p : null) },

  form_ack: {
    async render(payload: LeadJobPayload, { db, env }) {
      const lead = await db.select().from(leads).where(eq(leads.id, payload.lead_id)).get()
      if (!lead) return null
      const settings = await readCompanySettings(env.DB)
      const { to, subject } = envelopeOf(payload, () => formAckEnvelope(lead, settings))
      if (!to.length) return null
      const text = [
        // Plan 010 F6: the first name is public input sent from our domain; only a plain name is echoed back.
        `Hi ${lead.firstName && /^[A-Za-z][A-Za-z'-]{0,39}$/.test(lead.firstName) ? lead.firstName : 'there'},`,
        '',
        `Thanks for contacting ${settings.name}. We received your request and will be in touch soon to set up your free on-site estimate.`,
        '',
        settings.phone ? `Questions before then? Call us at ${settings.phone} or reply to this email.` : 'Questions before then? Just reply to this email.',
        '',
        settings.name,
      ].join('\n')
      return {
        to,
        subject,
        text,
        ...(settings.email ? { replyTo: settings.email } : {}),
      }
    },
  },
}

const fullName = (l: { firstName: string | null; lastName: string | null }) => [l.firstName, l.lastName].filter(Boolean).join(' ')
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null)
function safeJson(s: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(s)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
const line = (label: string, value: string | null) => (value ? `${label}: ${value}` : null)
