import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mockSiteverify, postIntake, inspectionFormPayload, randomPhone } from './intake-helpers'

// PLAN.md > Intake contract: one D1 batch = Lead + `form` activity + consent event + notification jobs + result_json.

beforeEach(() => {
  mockSiteverify()
})
afterEach(() => vi.restoreAllMocks())

async function submit(overrides: Record<string, unknown> = {}) {
  const body = inspectionFormPayload({ submission_key: crypto.randomUUID(), phone: randomPhone(), email: `${crypto.randomUUID()}@example.com`, ...overrides })
  const res = await postIntake(body)
  expect(res.status).toBe(200)
  const { lead_id } = await res.json<{ lead_id: string }>()
  const submission = await env.DB.prepare('SELECT id, received_at FROM form_submissions WHERE submission_key = ?')
    .bind(body.submission_key)
    .first<{ id: string; received_at: number }>()
  return { leadId: lead_id, submission: submission!, body }
}

const all = (sql: string, ...binds: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...binds)
    .all<Record<string, unknown>>()
    .then((r) => r.results)

it('the Lead gets a form activity at the time the Form submission was received', async () => {
  const { leadId, submission } = await submit({ message: 'Ice dam over the porch.' })

  const activity = await all('SELECT kind, created_at, body FROM lead_activity WHERE lead_id = ?', leadId)
  expect(activity).toHaveLength(1)
  expect(activity[0]).toMatchObject({ kind: 'form', created_at: submission.received_at })
  expect(activity[0].body).toContain('Ice dam over the porch.')
})

it('ticking the SMS checkbox records a text-consent grant that occurred when the submission was received', async () => {
  const { leadId, submission, body } = await submit({ sms_consent: true, sms_consent_disclosure: 'quote-sms-2026-10' })

  const events = await all('SELECT * FROM consent_events WHERE source_ref = ?', submission.id)
  expect(events).toEqual([
    expect.objectContaining({
      phone_e164: `+1${body.phone}`,
      program: 'sms_followup',
      event: 'grant',
      occurred_at: submission.received_at,
      disclosure_version: 'quote-sms-2026-10',
      source: 'form',
      lead_id: leadId,
    }),
  ])
})

it('without the SMS checkbox no consent is recorded, whatever else was agreed to', async () => {
  const { submission } = await submit({ consent: true, sms_consent: false })

  expect(await all('SELECT id FROM consent_events WHERE source_ref = ?', submission.id)).toEqual([])
})

it('the Owner alert and the form acknowledgement are enqueued for sending', async () => {
  const { leadId, submission } = await submit()

  const jobs = await all('SELECT kind, state, payload_json FROM notification_jobs WHERE dedupe_key LIKE ? ORDER BY kind', `%${submission.id}`)
  expect(jobs.map((j) => [j.kind, j.state])).toEqual([
    ['form_ack', 'pending'],
    ['owner_alert', 'pending'],
  ])
  // Plus the envelope frozen at enqueue (plan 006 S11).
  for (const j of jobs) {
    expect(JSON.parse(String(j.payload_json))).toEqual({ lead_id: leadId, submission_id: submission.id, to: expect.any(Array), subject: expect.any(String) })
  }
})

it('no email address, no acknowledgement; the Owner alert still goes', async () => {
  const { submission } = await submit({ email: '' })

  const jobs = await all('SELECT kind FROM notification_jobs WHERE dedupe_key LIKE ?', `%${submission.id}`)
  expect(jobs.map((j) => j.kind)).toEqual(['owner_alert'])
})

// Pine & Gable scores Leads with its site's scoring rules; Good Cover's form has none, so no score is stored.
it('a lead score the browser sends is ignored; Good Cover Leads have no score', async () => {
  const { leadId } = await submit({ leadScore: 999 })

  const lead = await env.DB.prepare('SELECT lead_score FROM leads WHERE id = ?').bind(leadId).first()
  expect(lead).toEqual({ lead_score: null })
})
