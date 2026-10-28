import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAuth } from '#/lib/auth'
import { dispatchDueJobs, dispatchJob } from '#/lib/outbox'
import { mockSiteverify, postIntake, inspectionFormPayload, randomPhone } from './intake-helpers'
import { mockResend, sendingEnv } from './outbox-helpers'

// The emails that go through the outbox (FLW-143): Owner alert and acknowledgement for a new Lead, password reset.

beforeEach(() => {
  mockSiteverify()
})
afterEach(() => vi.restoreAllMocks())

const jobId = (dedupeKey: string) =>
  env.DB.prepare('SELECT id FROM notification_jobs WHERE dedupe_key = ?')
    .bind(dedupeKey)
    .first<{ id: string }>()
    .then((r) => r!.id)

async function submitLead(overrides: Record<string, unknown> = {}) {
  const body = inspectionFormPayload({ submission_key: crypto.randomUUID(), phone: randomPhone(), ...overrides })
  const res = await postIntake(body)
  expect(res.status).toBe(200)
  const { lead_id } = await res.json<{ lead_id: string }>()
  const submission = await env.DB.prepare('SELECT id FROM form_submissions WHERE submission_key = ?').bind(body.submission_key).first<{ id: string }>()
  return { leadId: lead_id, submissionId: submission!.id }
}

async function setCompany(fields: { owner_alert_emails: string | null; email: string | null; phone: string | null }) {
  await env.DB.prepare('UPDATE company_settings SET owner_alert_emails = ?, email = ?, phone = ? WHERE id = 1')
    .bind(fields.owner_alert_emails, fields.email, fields.phone)
    .run()
}

it('a new Lead sends an Owner alert to every Owner alert address, with the Lead and a link to it', async () => {
  await setCompany({ owner_alert_emails: 'jeff@turnersdecks.com, aaron@turnersdecks.com', email: 'office@turnersdecks.com', phone: null })
  const resend = mockResend()
  const { leadId, submissionId } = await submitLead({ name: 'Dana Whitcomb', email: 'dana@example.com', message: 'Shingles blew off.' })
  const id = await jobId(`owner_alert:${submissionId}`)

  await dispatchJob(sendingEnv, id, { fetch: resend.fetch })

  const [call] = resend.callsFor(id)
  expect(call.body.to).toEqual(['jeff@turnersdecks.com', 'aaron@turnersdecks.com'])
  expect(call.body.subject).toContain('Dana Whitcomb')
  expect(call.body.text).toContain('dana@example.com')
  expect(call.body.text).toContain('Shingles blew off.')
  expect(call.body.text).toContain(`${env.BETTER_AUTH_URL}/leads/${leadId}`)
})

it('with no Owner alert addresses set, the Owner alert goes to the company email', async () => {
  await setCompany({ owner_alert_emails: null, email: 'office@turnersdecks.com', phone: null })
  const resend = mockResend()
  const { submissionId } = await submitLead()
  const id = await jobId(`owner_alert:${submissionId}`)

  await dispatchJob(sendingEnv, id, { fetch: resend.fetch })

  expect(resend.callsFor(id)[0].body.to).toEqual(['office@turnersdecks.com'])
})

it('the Homeowner gets an acknowledgement by first name; replies go to the company email', async () => {
  await setCompany({ owner_alert_emails: null, email: 'office@turnersdecks.com', phone: '(207) 360-7663' })
  const resend = mockResend()
  const { submissionId } = await submitLead({ name: 'Dana Whitcomb', email: 'dana@example.com' })
  const id = await jobId(`form_ack:${submissionId}`)

  await dispatchJob(sendingEnv, id, { fetch: resend.fetch })

  const [call] = resend.callsFor(id)
  expect(call.body.to).toEqual(['dana@example.com'])
  expect(call.body.reply_to).toBe('office@turnersdecks.com')
  expect(call.body.text).toMatch(/^Hi Dana,/)
  expect(call.body.text).toContain('(207) 360-7663')
})

it('the acknowledgement greets by a plain first name only, never by text that could carry a link (plan 010 F6)', async () => {
  const resend = mockResend()
  const greeting = async (name: string) => {
    const { submissionId } = await submitLead({ name, email: `ack-${crypto.randomUUID()}@example.com` })
    const id = await jobId(`form_ack:${submissionId}`)
    await dispatchJob(sendingEnv, id, { fetch: resend.fetch })
    return resend.callsFor(id)[0].body.text.split('\n')[0]
  }
  expect(await greeting("O'Brien Smith")).toBe("Hi O'Brien,")
  expect(await greeting('evil.com Smith')).toBe('Hi there,')
  expect(await greeting('https://x.example Smith')).toBe('Hi there,')
  expect(await greeting(`${'a'.repeat(41)} Smith`)).toBe('Hi there,')
  expect(await greeting('Click⠀here⠀now Smith')).toBe('Hi there,')
  expect(await greeting('Clickㅤhere Smith')).toBe('Hi there,')
})

it('the cron sends a new Lead’s emails that were not sent straight away', async () => {
  const resend = mockResend()
  const { submissionId } = await submitLead({ email: 'dana@example.com' })

  await dispatchDueJobs(sendingEnv, { fetch: resend.fetch })

  expect(resend.callsFor(await jobId(`owner_alert:${submissionId}`))).toHaveLength(1)
  expect(resend.callsFor(await jobId(`form_ack:${submissionId}`))).toHaveLength(1)
})

it('a password reset email goes through the outbox', async () => {
  const resend = mockResend()
  const auth = createAuth(sendingEnv, { dispatch: { fetch: resend.fetch } })
  const email = `outbox-reset-${crypto.randomUUID()}@example.com`
  await auth.api.createUser({ body: { email, password: 'old password 123', name: 'Sam' } })

  await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } })

  await vi.waitFor(() => expect(resend.calls.filter((c) => c.body.to[0] === email)).toHaveLength(1))
  const [call] = resend.calls.filter((c) => c.body.to[0] === email)
  expect(call.body.subject).toBe('Reset your Turner’s Decks CRM password')
  expect(call.body.text).toMatch(/https?:\/\/\S+\/reset-password\/\S+/)
})
