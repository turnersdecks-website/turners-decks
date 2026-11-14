import { and, eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { getDb } from '#/db/client'
import { consentEvents, customers, leadActivity, leads, notificationJobs, quoConnection, quoWebhookEvents } from '#/db/schema'
import { customerIdFor } from '#/lib/customers.server'
import { readBoundedText } from '#/lib/intake'
import { prettyPhone, toE164 } from '#/lib/phone'
import { START_WORDS, STOP_WORDS, keywordOf, verifyQuoSignature } from '#/lib/quo'
import { leadCreated, stageMove } from '#/lib/stage-history.server'

// POST /api/public/quo-webhook (docs/adr/0004-quo-texting.md). Quo calls it for the connected number:
// - message.received: the text goes on the sender's Lead; a number we don't know becomes a new Lead (source `text`).
//   STOP-type words revoke text consent; START grants it again. A first text from a number with no consent history
//   counts as consent to reply about their project (they reached out), as the privacy policy says.
// - message.delivered: a text Pat sent from the Quo app goes on the Lead and moves a new Lead to contacted. Never
//   creates a Lead. The CRM's own texts (found by Quo message id on their outbox job) are skipped: the outbox logs them.
// - call.completed: the call goes on the Lead (answered / missed, length). An incoming answered call of 30 s or more
//   from an unknown number becomes a new Lead (source `phone`); shorter calls and missed calls without a voicemail
//   don't, so robocalls stay out of the Pipeline. An outgoing answered call moves a new Lead to contacted.
// - call.voicemail.completed: the voicemail and its transcript go on the Lead; an unknown caller becomes a new Lead.
// Every write for one delivery is one D1 batch with the delivery's `webhook-id`, so a retried delivery is a no-op, and
// activity rows carry the Quo id as their dedupe key, so the same text or call is never logged twice.

const MAX_BODY_BYTES = 64 * 1024
/** Shorter incoming answered calls from unknown numbers are not made into Leads (robocalls, wrong numbers). */
export const MIN_NEW_LEAD_CALL_S = 30

type Db = ReturnType<typeof getDb>
type Env = { DB: D1Database }
type Delivery = { id?: string; type?: string; createdAt?: string; data?: { resource?: Record<string, any>; context?: Record<string, any> } }

export async function handleQuoWebhook(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const raw = await readBoundedText(request, MAX_BODY_BYTES)
  if (raw === null) return new Response('Too large', { status: 413 })
  const db = getDb(env.DB)
  const conn = await db.select().from(quoConnection).where(eq(quoConnection.id, 1)).get()
  if (!conn) return new Response('Quo is not connected', { status: 404 })
  if (!(await verifyQuoSignature(conn.signingSecret, request.headers, raw, now))) return new Response('Bad signature', { status: 401 })

  const deliveryId = request.headers.get('webhook-id')!
  if (await db.select({ id: quoWebhookEvents.webhookId }).from(quoWebhookEvents).where(eq(quoWebhookEvents.webhookId, deliveryId)).get()) {
    return Response.json({ ok: true, duplicate: true })
  }
  let event: Delivery
  try {
    event = JSON.parse(raw) as Delivery
  } catch {
    return new Response('Not JSON', { status: 400 })
  }
  const type = typeof event.type === 'string' ? event.type.slice(0, 60) : 'unknown'
  const resource = event.data?.resource ?? {}
  const context = event.data?.context ?? {}
  // A delivery for some other Quo number (the webhook is filtered to ours; this is belt and braces).
  if (context.phoneNumberId && context.phoneNumberId !== conn.phoneNumberId) return Response.json({ ok: true, ignored: 'other number' })

  const writes = await writesFor(db, type, resource, context, conn.phoneNumberE164, now)
  const record = db.insert(quoWebhookEvents).values({ webhookId: deliveryId, type, receivedAt: new Date(now) })
  try {
    await db.batch([...writes, record] as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  } catch (err) {
    // A concurrent twin of this delivery got there first.
    if (/UNIQUE constraint failed: quo_webhook_events/.test(String(err))) return Response.json({ ok: true, duplicate: true })
    throw err
  }
  return Response.json({ ok: true })
}

async function writesFor(db: Db, type: string, r: Record<string, any>, ctx: Record<string, any>, ours: string, now: number): Promise<BatchItem<'sqlite'>[]> {
  const at = new Date(Date.parse(r.createdAt ?? '') || now)
  const quoId = typeof r.id === 'string' ? r.id : null
  if (!quoId) return []

  if (type === 'message.received') {
    const phone = toE164(String(ctx.senderIdentifier ?? ''))
    if (!phone || phone === ours) return []
    const text = typeof r.text === 'string' ? r.text : ''
    const media = Array.isArray(r.media) ? r.media.length : 0
    const word = keywordOf(text)
    const stop = STOP_WORDS.includes(word)
    const start = START_WORDS.includes(word)
    const lead = (await leadByPhone(db, phone)) ?? (stop ? null : await newLead(db, { phone, source: 'text', at, ctx }))
    const writes: BatchItem<'sqlite'>[] = lead ? [...lead.writes] : []
    const leadId = lead?.id ?? null
    const body = [text.trim(), media ? `[${media} photo${media === 1 ? '' : 's'}]` : ''].filter(Boolean).join('\n') || '(empty text)'
    if (leadId) writes.push(activity(db, { leadId, kind: 'text', direction: 'inbound', body, dedupeKey: `quo:${quoId}`, at }))
    const consent = stop ? 'revoke' : start ? 'grant' : (await hasConsentHistory(db, phone)) ? null : 'grant'
    if (consent) writes.push(consentWrite(db, { phone, event: consent, at, leadId, ref: quoId }))
    return writes
  }

  if (type === 'message.delivered') {
    const ids = [ctx.senderIdentifier, ...(Array.isArray(ctx.recipientIdentifiers) ? ctx.recipientIdentifiers : [])].map((v) => toE164(String(v ?? '')))
    const phone = ids.find((p) => p && p !== ours)
    if (!phone) return []
    const lead = await leadByPhone(db, phone)
    if (!lead) return []
    const body = typeof r.text === 'string' && r.text.trim() ? r.text.trim() : '(text)'
    // The CRM's own automatic texts come back here too: they are logged by the outbox and are not Pat reaching out.
    const fromCrm = await db.select({ id: notificationJobs.id }).from(notificationJobs).where(eq(notificationJobs.providerMessageId, quoId)).get()
    if (fromCrm) return []
    return [activity(db, { leadId: lead.id, kind: 'text', direction: 'outbound', body, dedupeKey: `quo:${quoId}`, at }), ...contacted(db, lead.id, 'Text sent from Quo', at)]
  }

  if (type === 'call.completed') {
    const phone = toE164(String(ctx.participants?.external?.[0] ?? ''))
    if (!phone || phone === ours) return []
    const incoming = r.direction === 'incoming'
    const seconds = typeof r.duration === 'number' ? r.duration : null
    const answered = r.status === 'answered'
    let lead = await leadByPhone(db, phone)
    const writes: BatchItem<'sqlite'>[] = []
    if (!lead && incoming && answered && (seconds ?? 0) >= MIN_NEW_LEAD_CALL_S) {
      lead = await newLead(db, { phone, source: 'phone', at, ctx })
      writes.push(...lead.writes)
    }
    if (!lead) return []
    const outcome = answered ? 'Connected' : r.hasVoicemail ? 'Left voicemail' : 'No answer'
    writes.push(
      activity(db, {
        leadId: lead.id,
        kind: 'call',
        direction: incoming ? 'inbound' : 'outbound',
        outcome,
        durationMin: seconds ? Math.max(1, Math.round(seconds / 60)) : null,
        body: `${incoming ? 'Incoming' : 'Outgoing'} call on Quo${r.status && !answered && !r.hasVoicemail ? ` (${String(r.status).replace(/-/g, ' ')})` : ''}`,
        dedupeKey: `quo:${quoId}`,
        at,
      }),
    )
    if (!incoming && answered) writes.push(...contacted(db, lead.id, 'Call made from Quo', at))
    return writes
  }

  if (type === 'call.voicemail.completed') {
    const phone = toE164(String(r.from ?? ''))
    if (!phone || phone === ours) return []
    const lead = (await leadByPhone(db, phone)) ?? (await newLead(db, { phone, source: 'phone', at, ctx }))
    const transcript = typeof r.transcript === 'string' && r.transcript.trim() ? r.transcript.trim() : null
    return [
      ...lead.writes,
      activity(db, {
        leadId: lead.id,
        kind: 'call',
        direction: 'inbound',
        outcome: 'Left voicemail',
        durationMin: typeof r.duration === 'number' ? Math.max(1, Math.round(r.duration / 60)) : null,
        body: transcript ? `Voicemail: ${transcript}` : 'Voicemail (no transcript)',
        dedupeKey: `quo-vm:${r.voicemailId ?? quoId}`,
        at,
      }),
    ]
  }
  return []
}

type FoundLead = { id: string; writes: BatchItem<'sqlite'>[] }

async function leadByPhone(db: Db, phone: string): Promise<FoundLead | null> {
  const row = await db.select({ id: leads.id }).from(leads).where(eq(leads.phoneE164, phone)).get()
  return row ? { id: row.id, writes: [] } : null
}

/**
 * A new Lead for a number we don't know. A past Customer's number joins their Customer and takes their name;
 * otherwise the name Quo has for the contact, if any. The phone's unique index makes a concurrent twin fail the batch.
 */
async function newLead(db: Db, f: { phone: string; source: 'text' | 'phone'; at: Date; ctx: Record<string, any> }): Promise<FoundLead> {
  const customerId = await customerIdFor(db, { phoneE164: f.phone, emailLower: null })
  const customer = customerId
    ? await db.select({ firstName: customers.firstName, lastName: customers.lastName }).from(customers).where(eq(customers.id, customerId)).get()
    : null
  const contact = Array.isArray(f.ctx.contacts) ? f.ctx.contacts[0] : null
  const quoName = [contact?.firstName, contact?.lastName].filter((v) => typeof v === 'string' && v.trim()).join(' ') || (typeof contact?.name === 'string' ? contact.name : '')
  const customerName = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ')
  const [firstName, ...rest] = (customerName || quoName || '').trim().split(/\s+/)
  const id = crypto.randomUUID()
  const label = f.source === 'text' ? 'First texted the Quo number' : 'First called the Quo number'
  return {
    id,
    writes: [
      db.insert(leads).values({
        id,
        firstName: firstName ? firstName.slice(0, 60) : null,
        lastName: rest.length ? rest.join(' ').slice(0, 60) : null,
        phone: prettyPhone(f.phone),
        phoneE164: f.phone,
        stage: 'new',
        source: f.source,
        firstSource: f.source,
        firstTouchJson: JSON.stringify({ channel: f.source, via: 'quo' }),
        message: label,
        customerId,
        createdAt: f.at,
        updatedAt: f.at,
      }),
      leadCreated(db, id, { reason: label }),
    ],
  }
}

function activity(
  db: Db,
  a: { leadId: string; kind: 'text' | 'call'; direction: 'inbound' | 'outbound'; body: string; dedupeKey: string; at: Date; outcome?: string; durationMin?: number | null },
) {
  return db
    .insert(leadActivity)
    .values({
      id: crypto.randomUUID(),
      leadId: a.leadId,
      kind: a.kind,
      direction: a.direction,
      outcome: a.outcome ?? null,
      durationMin: a.durationMin ?? null,
      body: a.body.slice(0, 8000),
      dedupeKey: a.dedupeKey,
      createdAt: a.at,
    })
    .onConflictDoNothing()
}

/** Pat reached out (an outgoing text or answered call): a new Lead becomes contacted, as when Staff log contact. */
function contacted(db: Db, leadId: string, reason: string, at: Date): BatchItem<'sqlite'>[] {
  const isNew = and(eq(leads.id, leadId), eq(leads.stage, 'new'))!
  return [stageMove(db, 'contacted', isNew, { at, reason }), db.update(leads).set({ stage: 'contacted', updatedAt: new Date() }).where(isNew)]
}

async function hasConsentHistory(db: Db, phone: string) {
  return Boolean(
    await db
      .select({ id: consentEvents.id })
      .from(consentEvents)
      .where(and(eq(consentEvents.phoneE164, phone), eq(consentEvents.program, 'sms_followup')))
      .get(),
  )
}

function consentWrite(db: Db, c: { phone: string; event: 'grant' | 'revoke'; at: Date; leadId: string | null; ref: string }) {
  return db.insert(consentEvents).values({
    id: crypto.randomUUID(),
    phoneE164: c.phone,
    program: 'sms_followup',
    event: c.event,
    occurredAt: c.at,
    disclosureVersion: null,
    source: 'text',
    sourceRef: c.ref,
    leadId: c.leadId,
    recordedAt: new Date(),
  })
}
