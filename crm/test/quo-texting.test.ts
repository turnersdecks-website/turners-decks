import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/db/client'
import { dispatchJob, enqueueJob } from '#/lib/outbox'
import { signQuoDelivery } from '#/lib/quo'
import { connectQuo, saveTextingSettings } from '#/lib/texting.server'
import { estimatorPayload, mockSiteverify, postIntake, randomPhone } from './intake-helpers'
import { insertLead, leadRow, stageChanges } from './lead-helpers'
import { readJob } from './outbox-helpers'

// docs/adr/0004-quo-texting.md: Quo's webhook puts texts and calls on Leads; the CRM texts from the Quo number only
// once texting is switched on, and only to Homeowners with text consent.

const SECRET = `whsec_${btoa('test-signing-secret-0123456789abcdef')}`
const OUR_NUMBER = '+14849393325'
const PN = 'PNtest000000000000000000000000'
const e164 = (ten: string) => `+1${ten}`

async function connect(textingEnabled = false) {
  await env.DB.prepare(
    `INSERT INTO quo_connection (id, phone_number_id, phone_number_e164, webhook_id, signing_secret, connected_at)
     VALUES (1, ?, ?, '42', ?, ?) ON CONFLICT(id) DO UPDATE SET signing_secret = excluded.signing_secret`,
  )
    .bind(PN, OUR_NUMBER, SECRET, Date.now())
    .run()
  await env.DB.prepare('UPDATE company_settings SET texting_enabled = ? WHERE id = 1').bind(textingEnabled ? 1 : 0).run()
}

async function deliver(type: string, data: Record<string, unknown>, opts: { id?: string; secret?: string; ts?: number } = {}) {
  const id = opts.id ?? `msg_${crypto.randomUUID()}`
  const ts = opts.ts ?? Math.floor(Date.now() / 1000)
  const body = JSON.stringify({ id: `EV${crypto.randomUUID()}`, apiVersion: '2026-03-30', createdAt: new Date().toISOString(), type, data })
  return SELF.fetch('http://localhost/api/public/quo-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': await signQuoDelivery(opts.secret ?? SECRET, id, ts, body) },
    body,
  })
}

const textFrom = (phone: string, text: string, id = `AC${crypto.randomUUID()}`) =>
  deliver('message.received', {
    resource: { id, text, direction: 'incoming', status: 'received', createdAt: new Date().toISOString() },
    context: { phoneNumberId: PN, senderIdentifier: phone, recipientIdentifiers: [OUR_NUMBER] },
  })

const callWith = (phone: string, r: Record<string, unknown>) =>
  deliver('call.completed', {
    resource: { id: `AC${crypto.randomUUID()}`, createdAt: new Date().toISOString(), ...r },
    context: { phoneNumberId: PN, participants: { workspace: [OUR_NUMBER], external: [phone], resolution: 'resolved' } },
  })

const leadByPhone = (phone: string) => env.DB.prepare('SELECT * FROM leads WHERE phone_e164 = ?').bind(phone).first<Record<string, any>>()
const activityOf = (leadId: string) =>
  env.DB.prepare('SELECT kind, direction, outcome, body, duration_min FROM lead_activity WHERE lead_id = ? ORDER BY created_at, rowid').bind(leadId).all<Record<string, any>>().then((r) => r.results)
const consentOf = (phone: string) =>
  env.DB.prepare('SELECT event, source FROM consent_events WHERE phone_e164 = ? ORDER BY occurred_at, recorded_at').bind(phone).all<Record<string, any>>().then((r) => r.results)

beforeEach(() => connect())

describe('Quo webhook', () => {
  it('refuses a delivery whose signature does not match, or that is too old', async () => {
    const phone = e164(randomPhone())
    expect((await deliver('message.received', { resource: { id: 'AC1', text: 'hi' }, context: { senderIdentifier: phone } }, { secret: `whsec_${btoa('wrong')}` })).status).toBe(401)
    expect((await deliver('message.received', { resource: { id: 'AC2', text: 'hi' }, context: { senderIdentifier: phone } }, { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401)
    expect(await leadByPhone(phone)).toBeNull()
  })

  it('a text from a number we do not know becomes a new Lead with the text on it, and counts as text consent', async () => {
    const phone = e164(randomPhone())
    expect((await textFrom(phone, 'Hi, do you build composite decks in Pottstown?')).status).toBe(200)

    const lead = await leadByPhone(phone)
    expect(lead).toMatchObject({ source: 'text', first_source: 'text', stage: 'new' })
    expect(await activityOf(lead!.id)).toEqual([
      expect.objectContaining({ kind: 'text', direction: 'inbound', body: 'Hi, do you build composite decks in Pottstown?' }),
    ])
    expect(await consentOf(phone)).toEqual([{ event: 'grant', source: 'text' }])
  })

  it('a text from a known Lead goes on that Lead; the same delivery twice is logged once', async () => {
    const phone = e164(randomPhone())
    const leadId = await insertLead({ phoneE164: phone })
    const id = `msg_${crypto.randomUUID()}`
    const data = { resource: { id: 'ACsame', text: 'Tuesday works', createdAt: new Date().toISOString() }, context: { phoneNumberId: PN, senderIdentifier: phone } }
    await deliver('message.received', data, { id })
    expect((await (await deliver('message.received', data, { id })).json<Record<string, unknown>>()).duplicate).toBe(true)
    // A new delivery of the same Quo message (a different webhook-id) is still logged once.
    await deliver('message.received', data)

    expect(await activityOf(leadId)).toEqual([expect.objectContaining({ kind: 'text', direction: 'inbound', body: 'Tuesday works' })])
    expect((await leadRow(leadId))?.stage).toBe('new')
  })

  it('STOP revokes text consent and never creates a Lead; START grants it again', async () => {
    const known = e164(randomPhone())
    await insertLead({ phoneE164: known })
    await textFrom(known, 'Thanks')
    await textFrom(known, 'STOP')
    expect((await consentOf(known)).map((c) => c.event)).toEqual(['grant', 'revoke'])
    await textFrom(known, 'start')
    expect((await consentOf(known)).map((c) => c.event)).toEqual(['grant', 'revoke', 'grant'])

    const stranger = e164(randomPhone())
    await textFrom(stranger, 'Stop.')
    expect(await leadByPhone(stranger)).toBeNull()
    expect(await consentOf(stranger)).toEqual([{ event: 'revoke', source: 'text' }])
  })

  it('a short or missed call from an unknown number makes no Lead; a real conversation does', async () => {
    const robo = e164(randomPhone())
    await callWith(robo, { direction: 'incoming', status: 'answered', duration: 8 })
    await callWith(robo, { direction: 'incoming', status: 'unanswered', duration: null })
    expect(await leadByPhone(robo)).toBeNull()

    const caller = e164(randomPhone())
    await callWith(caller, { direction: 'incoming', status: 'answered', duration: 245 })
    const lead = await leadByPhone(caller)
    expect(lead).toMatchObject({ source: 'phone', stage: 'new' })
    expect(await activityOf(lead!.id)).toEqual([expect.objectContaining({ kind: 'call', direction: 'inbound', outcome: 'Connected', duration_min: 4 })])
  })

  it('Pat calling or texting a new Lead from Quo moves it to contacted', async () => {
    const phone = e164(randomPhone())
    const leadId = await insertLead({ phoneE164: phone })
    await callWith(phone, { direction: 'outgoing', status: 'answered', duration: 90 })

    expect((await leadRow(leadId))?.stage).toBe('contacted')
    expect((await stageChanges(leadId)).at(-1)).toMatchObject({ from_stage: 'new', to_stage: 'contacted', reason: 'Call made from Quo' })

    const other = e164(randomPhone())
    const otherId = await insertLead({ phoneE164: other })
    await deliver('message.delivered', {
      resource: { id: `AC${crypto.randomUUID()}`, text: 'Hi, this is Pat. When can I come by?', direction: 'outgoing' },
      context: { phoneNumberId: PN, senderIdentifier: OUR_NUMBER, recipientIdentifiers: [other] },
    })
    expect((await leadRow(otherId))?.stage).toBe('contacted')
    expect(await activityOf(otherId)).toEqual([expect.objectContaining({ kind: 'text', direction: 'outbound', body: 'Hi, this is Pat. When can I come by?' })])
  })

  it('a voicemail from an unknown number becomes a Lead with the transcript', async () => {
    const phone = e164(randomPhone())
    await deliver('call.voicemail.completed', {
      resource: { id: `VM${crypto.randomUUID()}`, voicemailId: `VM${crypto.randomUUID()}`, from: phone, to: OUR_NUMBER, duration: 40, transcript: 'Calling about a new deck, call me back.', createdAt: new Date().toISOString() },
      context: { phoneNumberId: PN },
    })
    const lead = await leadByPhone(phone)
    expect(lead).toMatchObject({ source: 'phone' })
    expect(await activityOf(lead!.id)).toEqual([expect.objectContaining({ kind: 'call', outcome: 'Left voicemail', body: 'Voicemail: Calling about a new deck, call me back.' })])
  })
})

describe('texting from the CRM', () => {
  const sendingEnv = { ...env, QUO_API_KEY: 'quo_test_key' }

  function mockQuo(answer: () => Response = () => Response.json({ data: { id: `AC${crypto.randomUUID()}` } }, { status: 202 })) {
    const calls: { url: string; auth: string | null; body: any }[] = []
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      calls.push({ url: req.url, auth: req.headers.get('authorization'), body: await req.json().catch(() => null) })
      return answer()
    }) as typeof globalThis.fetch
    return { fetch, calls }
  }

  async function queueReply(phone: string, leadId: string) {
    const job = enqueueJob(getDb(env.DB), { kind: 'sms_lead_reply', dedupeKey: `t:${crypto.randomUUID()}`, payload: { lead_id: leadId, to: phone, content: 'Hi Jane, this is Pat.' } })
    await job.insert
    return job.id
  }

  async function grant(phone: string) {
    await env.DB.prepare(
      "INSERT INTO consent_events (id, phone_e164, program, event, occurred_at, source, recorded_at) VALUES (?, ?, 'sms_followup', 'grant', ?, 'form', ?)",
    )
      .bind(crypto.randomUUID(), phone, Date.now(), Date.now())
      .run()
  }

  it('sends the instant reply from the Quo number once texting is on, and logs it on the Lead', async () => {
    await connect(true)
    const phone = e164(randomPhone())
    const leadId = await insertLead({ phoneE164: phone })
    await grant(phone)
    const quo = mockQuo()
    const jobId = await queueReply(phone, leadId)

    await dispatchJob(sendingEnv, jobId, { fetch: quo.fetch })

    expect(quo.calls).toEqual([{ url: 'https://api.quo.com/messages', auth: 'quo_test_key', body: { from: PN, to: [phone], content: 'Hi Jane, this is Pat.' } }])
    expect(await readJob(jobId)).toMatchObject({ state: 'sent', outcome: 'accepted' })
    // Quo then reports the same text as delivered: not logged twice, and an automatic reply is not "contacted".
    await deliver('message.delivered', {
      resource: { id: (await readJob(jobId))!.provider_message_id, text: 'Hi Jane, this is Pat.', direction: 'outgoing' },
      context: { phoneNumberId: PN, senderIdentifier: OUR_NUMBER, recipientIdentifiers: [phone] },
    })
    expect(await activityOf(leadId)).toEqual([expect.objectContaining({ kind: 'text', direction: 'outbound', body: 'Hi Jane, this is Pat.' })])
    expect((await leadRow(leadId))?.stage).toBe('new')
  })

  it('sends nothing while texting is switched off (before A2P approval), or without text consent', async () => {
    const phone = e164(randomPhone())
    const leadId = await insertLead({ phoneE164: phone })
    await grant(phone)
    const quo = mockQuo()
    const off = await queueReply(phone, leadId)
    await dispatchJob(sendingEnv, off, { fetch: quo.fetch })
    expect(await readJob(off)).toMatchObject({ outcome: 'failed' })

    await connect(true)
    const stranger = e164(randomPhone())
    const strangerLead = await insertLead({ phoneE164: stranger })
    const noConsent = await queueReply(stranger, strangerLead)
    await dispatchJob(sendingEnv, noConsent, { fetch: quo.fetch })
    expect(await readJob(noConsent)).toMatchObject({ outcome: 'failed' })
    expect(quo.calls).toEqual([])
  })

  it('never sends a text twice: a Quo error that may have sent it is given up, not retried', async () => {
    await connect(true)
    const phone = e164(randomPhone())
    const leadId = await insertLead({ phoneE164: phone })
    await grant(phone)
    const quo = mockQuo(() => Response.json({ message: 'Internal error' }, { status: 500 }))
    const jobId = await queueReply(phone, leadId)
    await dispatchJob(sendingEnv, jobId, { fetch: quo.fetch })
    await dispatchJob(sendingEnv, jobId, { fetch: quo.fetch, now: () => Date.now() + 60 * 60_000 })

    expect(quo.calls).toHaveLength(1)
    expect(await readJob(jobId)).toMatchObject({ state: 'dead', outcome: 'dead' })
  })

  it('a rate-limited text (429, nothing sent) is retried later', async () => {
    await connect(true)
    const phone = e164(randomPhone())
    const leadId = await insertLead({ phoneE164: phone })
    await grant(phone)
    let n = 0
    const quo = mockQuo(() => (++n === 1 ? Response.json({ message: 'Too many requests' }, { status: 429 }) : Response.json({ data: { id: 'ACok' } }, { status: 202 })))
    const jobId = await queueReply(phone, leadId)
    await dispatchJob(sendingEnv, jobId, { fetch: quo.fetch })
    expect(await readJob(jobId)).toMatchObject({ state: 'failed' })
    await dispatchJob(sendingEnv, jobId, { fetch: quo.fetch, now: () => Date.now() + 10 * 60_000 })
    expect(await readJob(jobId)).toMatchObject({ state: 'sent' })
    expect(quo.calls).toHaveLength(2)
  })

  it('a website Lead who ticks the text box gets an instant reply queued only when texting is on', async () => {
    mockSiteverify()
    const off = randomPhone()
    await postIntake(estimatorPayload({ phone: off, sms_consent: true, sms_consent_disclosure: '2026-11-13' }))
    const queued = () =>
      env.DB.prepare("SELECT payload_json FROM notification_jobs WHERE kind = 'sms_lead_reply'")
        .all<{ payload_json: string }>()
        .then((r) => r.results.map((j) => JSON.parse(j.payload_json)).filter((p) => [off, on, unticked].map(e164).includes(p.to)))
    const on = randomPhone()
    const unticked = randomPhone()
    expect(await queued()).toEqual([])

    await connect(true)
    await postIntake(estimatorPayload({ phone: on, first_name: 'Jane', sms_consent: true, sms_consent_disclosure: '2026-11-13' }))
    await postIntake(estimatorPayload({ phone: unticked }))
    expect(await queued()).toEqual([expect.objectContaining({ to: e164(on), content: expect.stringMatching(/^Hi Jane, this is Pat at .*Reply STOP to opt out\.$/) })])
  })
})

describe('Settings > Texting', () => {
  it('texting cannot be switched on before Quo is connected and the key is set', async () => {
    await env.DB.prepare('DELETE FROM quo_connection').run()
    const db = getDb(env.DB)
    await expect(saveTextingSettings(db, {}, { textingEnabled: true, ownerMobile: '' })).rejects.toMatchObject({ status: 400 })
    await expect(saveTextingSettings(db, { QUO_API_KEY: 'k' }, { textingEnabled: true, ownerMobile: '' })).rejects.toMatchObject({ status: 400 })
    await connect()
    expect(await saveTextingSettings(db, { QUO_API_KEY: 'k' }, { textingEnabled: true, ownerMobile: '(484) 555-0199' })).toEqual({ textingEnabled: true, ownerMobile: '+14845550199' })
  })

  it('Connect Quo finds the number, makes the webhook and keeps its signing secret; reconnecting replaces it', async () => {
    await env.DB.prepare('DELETE FROM quo_connection').run()
    const calls: string[] = []
    let hook = 100
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      calls.push(`${req.method} ${new URL(req.url).pathname}`)
      if (req.method === 'GET') return Response.json({ data: [{ id: 'PNother', number: '+16105550000' }, { id: PN, number: OUR_NUMBER }] })
      if (req.method === 'POST') return Response.json({ data: { id: String(++hook), key: SECRET } }, { status: 201 })
      return new Response(null, { status: 204 })
    }) as typeof globalThis.fetch
    const db = getDb(env.DB)
    const qEnv = { QUO_API_KEY: 'k', BETTER_AUTH_URL: 'https://crm.example' }

    await expect(connectQuo(db, qEnv, null, null, { fetch })).rejects.toMatchObject({ status: 400 })
    expect(await connectQuo(db, qEnv, '(484) 939-3325', null, { fetch })).toEqual({ phoneNumberE164: OUR_NUMBER })
    await connectQuo(db, qEnv, '484-939-3325', null, { fetch })

    expect(calls).toEqual(['GET /phone-numbers', 'GET /phone-numbers', 'POST /webhooks', 'GET /phone-numbers', 'DELETE /webhooks/101', 'POST /webhooks'])
    expect(await env.DB.prepare('SELECT phone_number_id, webhook_id, signing_secret FROM quo_connection').first()).toEqual({ phone_number_id: PN, webhook_id: '102', signing_secret: SECRET })
  })
})
