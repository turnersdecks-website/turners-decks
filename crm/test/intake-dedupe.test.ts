import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mockSiteverify, postIntake, inspectionFormPayload, randomPhone } from './intake-helpers'

// PLAN.md > Intake contract > Dedupe rules.

beforeEach(() => {
  mockSiteverify()
})
afterEach(() => vi.restoreAllMocks())

const uniqueEmail = () => `${crypto.randomUUID()}@example.com`

async function submit(fields: Record<string, unknown>) {
  const res = await postIntake(inspectionFormPayload({ submission_key: crypto.randomUUID(), ...fields }))
  expect(res.status).toBe(200)
  return (await res.json<{ lead_id: string }>()).lead_id
}

const lead = (id: string) =>
  env.DB.prepare('SELECT first_name, last_name, email, email_lower, phone_e164, street, city, message, stage, source, needs_review FROM leads WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()

const activity = (leadId: string) =>
  env.DB.prepare('SELECT kind, body FROM lead_activity WHERE lead_id = ? ORDER BY kind')
    .bind(leadId)
    .all<{ kind: string; body: string }>()
    .then((r) => r.results)

it('phone and email matching different Leads: attach to the phone match, copy neither, flag it for review', async () => {
  const phoneA = randomPhone()
  const emailB = uniqueEmail()
  const a = await submit({ name: 'Alice Phone', phone: phoneA, email: '' })
  const b = await submit({ name: 'Bob Email', phone: '', email: emailB })

  const attached = await submit({ name: 'Alice Phone', phone: phoneA, email: emailB })

  expect(attached).toBe(a)
  expect(await lead(a)).toMatchObject({ email: null, email_lower: null, phone_e164: `+1${phoneA}`, needs_review: 1 })
  expect(await lead(b)).toMatchObject({ email_lower: emailB, phone_e164: null, needs_review: 0 })
  const notes = (await activity(a)).filter((x) => x.kind === 'note')
  expect(notes).toHaveLength(1)
  expect(notes[0].body).toContain(b)
  expect(notes[0].body).toContain('Bob Email')
  expect(notes[0].body).toContain(emailB)
  expect((await activity(b)).map((x) => x.kind)).toEqual(['form'])
})

it('a repeat submission fills the Lead’s empty fields but never overwrites what Staff already have', async () => {
  const phone = randomPhone()
  const first = await submit({ name: 'Cora', phone, email: '', address: '', message: 'First message.', projectType: '' })
  await env.DB.prepare(`UPDATE leads SET stage = 'contacted' WHERE id = ?`).bind(first).run()

  const again = await submit({
    name: 'Cora Lane',
    phone,
    email: '',
    address: '7 Shore Rd, Wells, PA 04090',
    message: 'Second message.',
    projectType: 'partial',
  })

  expect(again).toBe(first)
  expect(await lead(first)).toMatchObject({
    first_name: 'Cora',
    last_name: 'Lane',
    street: '7 Shore Rd',
    city: 'Wells',
    message: 'First message.',
    stage: 'contacted',
    source: 'website',
    needs_review: 0,
  })
  expect((await activity(first)).map((x) => x.kind)).toEqual(['form', 'form'])
})

// Plan 010 F4: the intake is public, so a phone or email it was given never becomes a matched Lead's contact on its own.
const formAcks = (leadId: string) =>
  env.DB.prepare(`SELECT payload_json FROM notification_jobs WHERE kind = 'form_ack' AND json_extract(payload_json, '$.lead_id') = ?`)
    .bind(leadId)
    .all<{ payload_json: string }>()
    .then((r) => r.results.map((j) => JSON.parse(j.payload_json) as { to?: string[] }))

it('a repeat submission with a new email leaves it off the Lead, notes it for Staff and sends no acknowledgement', async () => {
  const phone = randomPhone()
  const email = uniqueEmail()
  const id = await submit({ phone, email: '' })

  await submit({ phone, email })

  expect(await lead(id)).toMatchObject({ email: null, email_lower: null, needs_review: 1 })
  const notes = (await activity(id)).filter((x) => x.kind === 'note')
  expect(notes).toHaveLength(1)
  expect(notes[0].body).toContain(email)
  expect(await formAcks(id)).toHaveLength(0)
})

it('a repeat submission by email with a new phone leaves it off the Lead, notes it, and acknowledges to the stored email', async () => {
  const phone = randomPhone()
  const email = uniqueEmail()
  const id = await submit({ phone: '', email })

  await submit({ phone, email })

  expect(await lead(id)).toMatchObject({ phone_e164: null, email_lower: email, needs_review: 1 })
  const notes = (await activity(id)).filter((x) => x.kind === 'note')
  expect(notes).toHaveLength(1)
  expect(notes[0].body).toContain(`+1${phone}`)
  const acks = await formAcks(id)
  expect(acks).toHaveLength(2)
  for (const ack of acks) expect(ack.to).toEqual([email])
})
