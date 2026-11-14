import { and, desc, eq } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { companySettings, consentEvents, quoConnection } from '#/db/schema'
import { badRequest } from '#/lib/input'
import { enqueueJob } from '#/lib/outbox'
import { toE164 } from '#/lib/phone'
import { type QuoDeps, type QuoPhoneNumber, createWebhook, deleteWebhook, listPhoneNumbers, numberOf } from '#/lib/quo'

// When the CRM may send a text from the Quo number (docs/adr/0004-quo-texting.md). All three must hold:
// 1. Quo is connected (Settings > Texting made the webhook and knows the Quo number's id),
// 2. QUO_API_KEY is set on the Worker,
// 3. an admin switched texting on, which they do only after Quo shows carrier (A2P 10DLC) registration approved
//    (activation gate G1). Unregistered business texts to US numbers are blocked by the carriers.
// A Homeowner also needs text consent: their latest consent event for `sms_followup` is a grant (the website's
// "Text me about my project" box, or texting us START), and the Lead is not marked Do not contact.

type Db = ReturnType<typeof getDb>
export type TextingEnv = { QUO_API_KEY?: string }

export type TextingStatus =
  | { ready: true; phoneNumberId: string; phoneNumberE164: string }
  | { ready: false; reason: 'not_connected' | 'no_api_key' | 'switched_off'; phoneNumberE164: string | null }

export async function textingStatus(db: Db, env: TextingEnv): Promise<TextingStatus> {
  const [conn, settings] = await Promise.all([
    db.select().from(quoConnection).where(eq(quoConnection.id, 1)).get(),
    db.select({ on: companySettings.textingEnabled }).from(companySettings).where(eq(companySettings.id, 1)).get(),
  ])
  if (!conn) return { ready: false, reason: 'not_connected', phoneNumberE164: null }
  if (!env.QUO_API_KEY) return { ready: false, reason: 'no_api_key', phoneNumberE164: conn.phoneNumberE164 }
  if (!settings?.on) return { ready: false, reason: 'switched_off', phoneNumberE164: conn.phoneNumberE164 }
  return { ready: true, phoneNumberId: conn.phoneNumberId, phoneNumberE164: conn.phoneNumberE164 }
}

/** Quo is connected (DB only; the key and the switch are checked where they are known). */
export async function quoConnected(db: Db) {
  return Boolean(await db.select({ id: quoConnection.id }).from(quoConnection).where(eq(quoConnection.id, 1)).get())
}

/** Whether this number's latest text consent (follow-up texts) is a grant. No events = no consent. */
export async function hasTextConsent(db: Db, phoneE164: string): Promise<boolean> {
  const last = await db
    .select({ event: consentEvents.event })
    .from(consentEvents)
    .where(and(eq(consentEvents.phoneE164, phoneE164), eq(consentEvents.program, 'sms_followup')))
    .orderBy(desc(consentEvents.occurredAt), desc(consentEvents.recordedAt))
    .get()
  return last?.event === 'grant'
}

/** The instant reply to a website Lead who ticked the text box. Plain words, signed, with the opt-out line. */
export function leadReplyText(firstName: string | null, company: string) {
  // Plan 010 F6 (as form_ack): only a plain first name is echoed back.
  const name = firstName && /^[A-Za-z][A-Za-z'-]{0,39}$/.test(firstName) ? firstName : 'there'
  return `Hi ${name}, this is ${company}. Thanks for your request! We'll be in touch soon to set up your free estimate. You can text us at this number anytime. Reply STOP to opt out.`
}

/** Settings > Texting, for admins. Never includes the signing secret. */
export async function readTextingSettings(db: Db, env: TextingEnv & { BETTER_AUTH_URL: string }) {
  const [conn, settings, status] = await Promise.all([
    db.select().from(quoConnection).where(eq(quoConnection.id, 1)).get(),
    db.select({ on: companySettings.textingEnabled, ownerMobile: companySettings.ownerMobile }).from(companySettings).where(eq(companySettings.id, 1)).get(),
    textingStatus(db, env),
  ])
  return {
    hasApiKey: Boolean(env.QUO_API_KEY),
    connected: conn ? { phoneNumberE164: conn.phoneNumberE164, connectedAt: conn.connectedAt.getTime() } : null,
    textingEnabled: Boolean(settings?.on),
    ownerMobile: settings?.ownerMobile ?? null,
    ready: status.ready,
    webhookUrl: webhookUrl(env.BETTER_AUTH_URL),
  }
}

export const webhookUrl = (base: string) => `${base.replace(/\/+$/, '')}/api/public/quo-webhook`

/**
 * "Connect Quo": finds the Quo number (the one matching `wanted`, else the workspace's only number), makes the CRM's
 * webhook for it and stores what Quo returns. Reconnecting replaces the earlier webhook.
 */
export async function connectQuo(db: Db, env: TextingEnv & { BETTER_AUTH_URL: string }, wanted: string | null, staffId: string | null, deps: QuoDeps = {}) {
  const key = env.QUO_API_KEY
  if (!key) throw badRequest('Add the Quo API key to the CRM first (Cloudflare > Worker > Settings > Variables and secrets > QUO_API_KEY).')
  let numbers: QuoPhoneNumber[]
  try {
    numbers = await listPhoneNumbers(key, deps)
  } catch (err) {
    throw badRequest(`Quo refused the API key: ${err instanceof Error ? err.message : String(err)}`)
  }
  const want = wanted ? toE164(wanted) : null
  if (wanted && !want) throw badRequest('That is not a US phone number.')
  const match = want ? numbers.find((n) => toE164(numberOf(n)) === want) : numbers.length === 1 ? numbers[0] : null
  if (!match) {
    const list = numbers.map(numberOf).join(', ') || 'none'
    throw badRequest(want ? `Quo has no number ${want}. Numbers in this Quo workspace: ${list}.` : `Pick the number to connect. Numbers in this Quo workspace: ${list}.`)
  }
  const e164 = toE164(numberOf(match))
  if (!e164) throw badRequest(`Quo's number ${numberOf(match)} is not a US number.`)
  const before = await db.select().from(quoConnection).where(eq(quoConnection.id, 1)).get()
  if (before) await deleteWebhook(key, before.webhookId, deps)
  const hook = await createWebhook(key, { url: webhookUrl(env.BETTER_AUTH_URL), phoneNumberId: match.id, label: "Turner's Decks CRM" }, deps)
  if (!hook?.id || !hook.key) throw new Error('Quo made the webhook but returned no id or signing secret')
  const values = { phoneNumberId: match.id, phoneNumberE164: e164, webhookId: String(hook.id), signingSecret: hook.key, connectedAt: new Date(), connectedBy: staffId }
  await db
    .insert(quoConnection)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: quoConnection.id, set: values })
  return { phoneNumberE164: e164 }
}

/** Texting switch and Pat's cell. Switching on needs Quo connected and the key set. */
export async function saveTextingSettings(db: Db, env: TextingEnv, data: Record<string, unknown>) {
  if (typeof data.textingEnabled !== 'boolean') throw badRequest('Texting on or off is required.')
  const raw = typeof data.ownerMobile === 'string' ? data.ownerMobile.trim() : ''
  const ownerMobile = raw ? toE164(raw) : null
  if (raw && !ownerMobile) throw badRequest("Pat's cell must be a US phone number.")
  if (data.textingEnabled) {
    if (!env.QUO_API_KEY) throw badRequest('Add the Quo API key first.')
    if (!(await quoConnected(db))) throw badRequest('Connect Quo first.')
  }
  await db.update(companySettings).set({ textingEnabled: data.textingEnabled, ownerMobile }).where(eq(companySettings.id, 1))
  return { textingEnabled: data.textingEnabled, ownerMobile }
}

/**
 * Queues a text to Pat's cell from the Quo number (e.g. a photo link) and returns its job id, or a reason it could not.
 * The caller kicks the job.
 */
export async function queueOwnerText(db: Db, env: TextingEnv, content: string, dedupeKey: string) {
  const status = await textingStatus(db, env)
  if (!status.ready) return { queued: false as const, reason: status.reason }
  const to = (await db.select({ m: companySettings.ownerMobile }).from(companySettings).where(eq(companySettings.id, 1)).get())?.m
  if (!to) return { queued: false as const, reason: 'no_owner_mobile' as const }
  const job = enqueueJob(db, { kind: 'sms_owner', dedupeKey, payload: { to, content: content.slice(0, 1600) }, envelope: { to: [to], subject: 'Text: to Pat' } })
  await job.insert
  return { queued: true as const, jobId: job.id }
}
