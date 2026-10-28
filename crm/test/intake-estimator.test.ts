import { SELF, env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchJob } from '#/lib/outbox'
import type { EstimatorDocument } from '#/lib/estimator/document'
import { SEED_DOCUMENT } from '#/lib/estimator/seed'
import { BASE, DUMMY_TOKEN, ESTIMATOR_ANSWERS, SITE_ORIGIN, estimatorPayload, mockSiteverify, postIntake, randomPhone } from './intake-helpers'
import { mockResend, sendingEnv } from './outbox-helpers'

// FLW-201 (seam 1): the public estimator endpoint and estimator Form submissions at intake.

beforeEach(() => {
  mockSiteverify()
})
afterEach(() => vi.restoreAllMocks())

const ANSWERS = ESTIMATOR_ANSWERS

const submissionOf = (key: string) =>
  env.DB.prepare('SELECT id FROM form_submissions WHERE submission_key = ?').bind(key).first<{ id: string }>().then((r) => r!.id)
const snapshotOf = (submissionId: string) =>
  env.DB.prepare('SELECT * FROM estimate_snapshots WHERE submission_id = ?').bind(submissionId).first<Record<string, any>>()
const jobsOf = (submissionId: string) =>
  env.DB.prepare('SELECT id, kind, recipient, payload_json FROM notification_jobs WHERE dedupe_key LIKE ? ORDER BY kind')
    .bind(`%${submissionId}`)
    .all<{ id: string; kind: string; recipient: string; payload_json: string }>()
    .then((r) => r.results)

async function publish(edit: (d: EstimatorDocument) => void) {
  const doc = JSON.parse(JSON.stringify(SEED_DOCUMENT)) as EstimatorDocument
  edit(doc)
  const next = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM estimator_versions').first<{ v: number }>()
  await env.DB.prepare('INSERT INTO estimator_versions (version, document_json, published_at) VALUES (?, ?, ?)').bind(next!.v, JSON.stringify(doc), Date.now()).run()
  return next!.v
}

describe('GET /api/public/estimator', () => {
  const get = (origin: string | null = SITE_ORIGIN) =>
    SELF.fetch(`${BASE}/api/public/estimator`, { headers: origin ? { origin } : {} })

  it('gives the site the live questions, options and copy, cacheable, with its CORS header', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE_ORIGIN)
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/)
    const body = await res.json<{ version: number; steps: unknown[]; questions: Record<string, { label: string; options?: { value: string }[] }> }>()
    expect(body.version).toBeGreaterThanOrEqual(1)
    expect(body.steps).toHaveLength(8)
    expect(body.questions.material.label).toBe('Which decking material?')
    expect(body.questions.material.options!.map((o) => o.value)).toContain('pvc')
  })

  it('never includes a price, a multiplier or a site-review flag', async () => {
    const text = await (await get()).text()
    for (const secret of ['newPerSqft', 'perLf', 'multiplier', 'reviewFlag', 'minimumProjectPrice', 'Deck more than 10 feet high', 'Visible rot']) {
      expect(text).not.toContain(secret)
    }
  })

  it('refuses a page on another site', async () => {
    expect((await get('https://evil.example')).status).toBe(403)
  })
})

describe('an estimator Form submission', () => {
  it('is priced by the CRM, stored as an Estimate snapshot on the Lead, and the price comes back', async () => {
    const body = estimatorPayload()
    const res = await postIntake(body)
    expect(res.status).toBe(200)
    const out = await res.json<{ lead_id: string; estimate: Record<string, unknown> }>()
    expect(out.estimate).toEqual({ version: 1, low: 38000, high: 47000, belowMinimum: false, needsReview: false, sqft: 320, railingLf: 35, serviceArea: 'primary' })

    const snap = await snapshotOf(await submissionOf(body.submission_key))
    expect(snap).toMatchObject({ lead_id: out.lead_id, version: 1, low: 38000, mid: 42285, high: 47000, sqft: 320, service_area: 'primary' })
    expect(JSON.parse(snap!.answers_json)).toMatchObject({ material: 'standardComposite', zip: '19518' })
    expect(JSON.parse(snap!.questions_json).material.options.map((o: { label: string }) => o.label)).toContain('PVC decking')
    expect(JSON.parse(snap!.flags_json)).toEqual([])

    const lead = await env.DB.prepare('SELECT first_name, last_name, zip, service_type, message FROM leads WHERE id = ?').bind(out.lead_id).first()
    expect(lead).toEqual({ first_name: 'Jane', last_name: 'Doe', zip: '19518', service_type: 'Full deck replacement', message: 'Back deck is rotting.' })
    const activity = await env.DB.prepare("SELECT body FROM lead_activity WHERE lead_id = ? AND kind = 'form'").bind(out.lead_id).first<{ body: string }>()
    expect(activity!.body).toContain('estimate: $38,000 to $47,000 (Published version 1)')
    expect(activity!.body).toContain('timing: Within 3 months')
    expect(activity!.body).not.toContain('standardComposite')
  })

  it('is priced against the version the Homeowner answered, not the latest one', async () => {
    const v = await publish((d) => {
      d.questions.find((q) => q.key === 'material')!.options!.find((o) => o.value === 'standardComposite')!.price.newPerSqft = 170
    })
    const old = await (await postIntake(estimatorPayload({ estimator_version: 1 }))).json<{ estimate: { low: number } }>()
    const latest = await (await postIntake(estimatorPayload({ estimator_version: v }))).json<{ estimate: { low: number; version: number } }>()
    expect(old.estimate.low).toBe(38000)
    expect(latest.estimate.version).toBe(v)
    expect(latest.estimate.low).toBeGreaterThan(60000)
  })

  it('is refused (422) for a version that does not exist, and makes no Lead', async () => {
    const body = estimatorPayload({ estimator_version: 9999 })
    const res = await postIntake(body)
    expect(res.status).toBe(422)
    expect((await res.json<{ error: string }>()).error).toBe('unknown_version')
    expect(await snapshotOf(await submissionOf(body.submission_key))).toBeNull()
    expect(await env.DB.prepare('SELECT count(*) AS n FROM leads WHERE phone = ?').bind(body.phone).first('n')).toBe(0)
  })

  it('is refused (422) with the question named when an answer is not one of that version’s options', async () => {
    const res = await postIntake(estimatorPayload({ answers: { ...ANSWERS, material: 'gold' } }))
    expect(res.status).toBe(422)
    const out = await res.json<{ error: string; errors: Record<string, string> }>()
    expect(out.error).toBe('invalid_answers')
    expect(out.errors).toHaveProperty('material')
  })

  it('a retry of the same submission gets the identical price and stores no second snapshot', async () => {
    const body = estimatorPayload()
    const first = await (await postIntake(body)).json()
    const again = await postIntake({ ...body, turnstile_token: 'already-used' })
    expect(await again.json()).toEqual(first)
    const n = await env.DB.prepare('SELECT count(*) AS n FROM estimate_snapshots WHERE submission_id = ?').bind(await submissionOf(body.submission_key)).first('n')
    expect(n).toBe(1)
  })

  it('flags a townhouse for review and says so in the reply, without the flag wording', async () => {
    const out = await (await postIntake(estimatorPayload({ answers: { ...ANSWERS, townhouse: 'yes' } }))).json<{ estimate: Record<string, unknown> }>()
    expect(out.estimate.needsReview).toBe(true)
    expect(JSON.stringify(out)).not.toContain('Townhouse')
  })
})

describe('emails for an estimator Form submission', () => {
  it('queues an Owner alert and an Estimate email, and no acknowledgement', async () => {
    const body = estimatorPayload()
    await postIntake(body)
    const jobs = await jobsOf(await submissionOf(body.submission_key))
    expect(jobs.map((j) => j.kind)).toEqual(['estimate_email', 'owner_alert'])
  })

  it('the Estimate email goes to the address in this submission with the range shown, even on a matched Lead', async () => {
    const phone = randomPhone()
    await postIntake(estimatorPayload({ phone, email: 'first@example.com' }))
    const body = estimatorPayload({ phone, email: 'second@example.com', first_name: 'Janet' })
    await postIntake(body)
    const job = (await jobsOf(await submissionOf(body.submission_key))).find((j) => j.kind === 'estimate_email')!
    const email = JSON.parse(job.payload_json) as { to: string; subject: string; text: string }
    expect(email.to).toBe('second@example.com')
    expect(email.subject).toBe('Your deck estimate from Turner’s Decks'.replace('’', "'"))
    expect(email.text).toContain('Hi Janet,')
    expect(email.text).toContain('$38,000 to $47,000')
  })

  it('the Owner alert carries the range, site-review flags and timing', async () => {
    const body = estimatorPayload({ answers: { ...ANSWERS, height: 'high' } })
    await postIntake(body)
    const job = (await jobsOf(await submissionOf(body.submission_key))).find((j) => j.kind === 'owner_alert')!
    const resend = mockResend()
    await dispatchJob(sendingEnv, job.id, { fetch: resend.fetch })
    const text = resend.callsFor(job.id)[0]!.body.text as string
    expect(text).toMatch(/Estimate shown: \$\d{2},\d{3} to \$\d{2},\d{3} \(Published version 1\)/)
    expect(text).toContain('Needs site review: Deck more than 10 feet high')
    expect(text).toContain('Timing: Within 3 months')
    expect(text).toContain('ZIP: 19518')
  })
})

describe('a quote form submission', () => {
  it('maps Turner’s quote form fields onto the Lead and still gets the acknowledgement', async () => {
    const body = {
      source: 'quote_form', submission_key: crypto.randomUUID(), turnstile_token: DUMMY_TOKEN, website: '',
      first_name: 'Sam', last_name: 'Ray', email: `sam-${crypto.randomUUID()}@example.com`, phone: randomPhone(),
      zip: '19518', project_type: 'Pool deck', approx_size: '16 x 20', material: 'Composite', notes: 'Around an above-ground pool.',
    }
    const res = await postIntake(body)
    expect(res.status).toBe(200)
    const { lead_id } = await res.json<{ lead_id: string }>()
    expect(await env.DB.prepare('SELECT first_name, last_name, zip, service_type, message FROM leads WHERE id = ?').bind(lead_id).first()).toEqual({
      first_name: 'Sam', last_name: 'Ray', zip: '19518', service_type: 'Pool deck', message: 'Around an above-ground pool.',
    })
    const jobs = await jobsOf(await submissionOf(body.submission_key))
    expect(jobs.map((j) => j.kind)).toEqual(['form_ack', 'owner_alert'])
  })
})
