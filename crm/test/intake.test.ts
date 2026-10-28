import { SELF, env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BASE, DUMMY_TOKEN, mockSiteverify, postIntake, inspectionFormPayload } from './intake-helpers'
import { signedInStaff } from './staff'

beforeEach(() => {
  mockSiteverify()
})
afterEach(() => vi.restoreAllMocks())

it('a site form submission becomes a Lead on the leads list Staff see', async () => {
  const { cookie } = await signedInStaff()
  const res = await postIntake(inspectionFormPayload())

  expect(res.status).toBe(200)
  const json = await res.json<{ ok: boolean; success: boolean; lead_id: string }>()
  expect(json).toMatchObject({ ok: true, success: true })
  expect(json.lead_id).toEqual(expect.any(String))

  const list = await SELF.fetch(`${BASE}/leads`, { headers: { cookie } })
  expect(list.status).toBe(200)
  const html = await list.text()
  expect(html).toContain('Dana')
  expect(html).toContain('Whitcomb')
  expect(html).toContain('+16105550142')
  expect(html).toContain('new')
})

it('a repeat submission with the same phone attaches to the same Lead', async () => {
  const first = await (await postIntake(inspectionFormPayload({ phone: '610-555-0177', email: 'a@example.com' }))).json<{ lead_id: string }>()
  const again = await postIntake(inspectionFormPayload({ phone: '(610) 555 0177', email: 'other@example.com' }))

  expect(again.status).toBe(200)
  expect(await again.json()).toMatchObject({ success: true, lead_id: first.lead_id })
})

it('a submission with the same email (any case) attaches to the same Lead', async () => {
  const first = await (await postIntake(inspectionFormPayload({ phone: '', email: 'Pat@Example.com' }))).json<{ lead_id: string }>()
  const again = await (await postIntake(inspectionFormPayload({ phone: '', email: 'pat@example.COM' }))).json<{ lead_id: string }>()

  expect(again.lead_id).toBe(first.lead_id)
})

it('every inspection form variant shape is accepted (full, compact, question by email only)', async () => {
  const full = inspectionFormPayload({ phone: '6105550198', email: 'full@example.com' })
  // The compact form (home and service pages) has no email or message field.
  const compact = { turnstile_token: DUMMY_TOKEN, source: 'inspection-compact', name: 'Sam Ray', phone: '6105550199', address: 'Douglassville', projectType: 'Roof inspection', website: '' }
  // A question may come with an email and no phone.
  const question = { turnstile_token: DUMMY_TOKEN, source: 'inspection', name: 'Lee Hart', email: 'lee@example.com', phone: '', address: 'Boyertown', projectType: 'Question', message: 'Do you do metal roofs?', website: '' }
  for (const body of [full, compact, question]) {
    const res = await postIntake(body)
    expect(res.status, body.source).toBe(200)
  }
})

it('a submission with no name or no way to reach the Homeowner is rejected but kept', async () => {
  const res = await postIntake(inspectionFormPayload({ phone: 'n/a', email: '' }))

  expect(res.status).toBe(422)
  expect(await res.json()).toMatchObject({ ok: false, success: false })
  const row = await env.DB.prepare(
    `SELECT p.state FROM form_submissions f JOIN submission_processing p ON p.submission_id = f.id
     WHERE f.raw_body LIKE '%n/a%'`,
  ).first<{ state: string }>()
  expect(row?.state).toBe('rejected')
})

it('a body that is not JSON carries no Turnstile token: refused and not stored', async () => {
  const res = await postIntake('name=Dana&phone=6105550142')

  expect(res.status).toBe(403)
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM form_submissions WHERE raw_body = 'name=Dana&phone=6105550142'`).first<{ n: number }>()
  expect(row?.n).toBe(0)
})

it('a body over 64 KB is refused before parsing', async () => {
  const res = await postIntake(inspectionFormPayload({ message: 'x'.repeat(65 * 1024) }))

  expect(res.status).toBe(413)
})

it('keeps the client submission_key when one is sent', async () => {
  const key = crypto.randomUUID()
  await postIntake(inspectionFormPayload({ submission_key: key, phone: '6105550133', email: 'k@example.com' }))

  const row = await env.DB.prepare('SELECT schema_version, source FROM form_submissions WHERE submission_key = ?')
    .bind(key)
    .first()
  expect(row).toEqual({ schema_version: 1, source: 'inspection' })
})

it('maps the site fields onto the Lead (name, address parts, service type, attribution)', async () => {
  const res = await postIntake(
    inspectionFormPayload({ name: 'Mary Ann Coffin', phone: '6105550144', email: 'mac@example.com' }),
  )
  const { lead_id } = await res.json<{ lead_id: string }>()

  const lead = await env.DB.prepare(
    `SELECT first_name, last_name, email_lower, phone_e164, street, city, state, zip, service_type,
            stage, source, first_source, attribution_json, first_touch_json FROM leads WHERE id = ?`,
  )
    .bind(lead_id)
    .first()
  expect(lead).toEqual({
    first_name: 'Mary',
    last_name: 'Ann Coffin',
    email_lower: 'mac@example.com',
    phone_e164: '+16105550144',
    street: '12 Main St',
    city: 'Douglassville',
    state: 'PA',
    zip: '19518',
    service_type: 'Roof replacement',
    stage: 'new',
    source: 'website',
    first_source: 'website',
    attribution_json: JSON.stringify({
      utm_source: 'google',
      utm_medium: 'cpc',
      landing_page_url: 'https://turnersdecks.com/contact?utm_source=google',
      referring_url: 'https://www.google.com/',
      device_type: 'mobile',
    }),
    first_touch_json: JSON.stringify({ utm_source: 'facebook' }),
  })
})

it('an invalid email with no phone is not a way to reach the Homeowner: rejected, kept, no Lead', async () => {
  const res = await postIntake({ turnstile_token: DUMMY_TOKEN, source: 'contact', name: 'Dana Bademail', email: 'n/a-bademail', phone: '' })

  expect(res.status).toBe(422)
  const row = await env.DB.prepare(
    `SELECT p.state FROM form_submissions f JOIN submission_processing p ON p.submission_id = f.id
     WHERE f.raw_body LIKE '%n/a-bademail%'`,
  ).first<{ state: string }>()
  expect(row?.state).toBe('rejected')
  const leads = await env.DB.prepare(`SELECT COUNT(*) AS n FROM leads WHERE last_name = 'Bademail'`).first<{ n: number }>()
  expect(leads?.n).toBe(0)
})

it('an invalid email alongside a valid phone is left off the Lead but kept in the Form submission', async () => {
  const res = await postIntake({ turnstile_token: DUMMY_TOKEN, source: 'contact', name: 'Jo Typo', email: 'jo@example', phone: '6105550166' })

  expect(res.status).toBe(200)
  const { lead_id } = await res.json<{ lead_id: string }>()
  const lead = await env.DB.prepare('SELECT email, email_lower, phone_e164 FROM leads WHERE id = ?').bind(lead_id).first()
  expect(lead).toEqual({ email: null, email_lower: null, phone_e164: '+16105550166' })
  const raw = await env.DB.prepare(
    `SELECT f.raw_body FROM form_submissions f JOIN submission_processing p ON p.submission_id = f.id WHERE p.lead_id = ?`,
  )
    .bind(lead_id)
    .first<{ raw_body: string }>()
  expect(raw?.raw_body).toContain('jo@example')
})
