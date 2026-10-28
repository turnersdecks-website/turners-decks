import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mockSiteverify, postIntake, inspectionFormPayload, randomPhone } from './intake-helpers'

beforeEach(() => {
  mockSiteverify()
})
afterEach(() => vi.restoreAllMocks())

it('a filled honeypot looks like success to the bot but makes no Lead and is kept as rejected', async () => {
  const phone = randomPhone()
  const res = await postIntake(inspectionFormPayload({ phone, email: '', website: 'http://spam.example' }))

  expect(res.status).toBe(200)
  const body = await res.json<Record<string, unknown>>()
  expect(body).toMatchObject({ ok: true, success: true })
  expect(body.lead_id).toBeUndefined()
  const leads = await env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE phone = ?').bind(phone).first<{ n: number }>()
  expect(leads?.n).toBe(0)
  const row = await env.DB.prepare(
    `SELECT p.state, p.error FROM form_submissions f JOIN submission_processing p ON p.submission_id = f.id WHERE f.raw_body LIKE ?`,
  )
    .bind(`%${phone}%`)
    .first()
  expect(row).toEqual({ state: 'rejected', error: 'honeypot' })
})

it('an empty honeypot is a normal submission', async () => {
  const res = await postIntake(inspectionFormPayload({ phone: randomPhone(), email: '', website: '' }))

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ lead_id: expect.any(String) })
})
