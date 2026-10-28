import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The site's own code (src/lib/crm-intake.ts): what both forms send and how the site reads the answer.
import { type EstimatorContact, type QuoteFields, estimatorPayload, quotePayload, submitToCrm } from '../../src/lib/crm-intake'
import { parsePublicResult } from '../../src/lib/estimator-public'
import type { EstimatorDocument } from '#/lib/estimator/document'
import { SEED_DOCUMENT } from '#/lib/estimator/seed'
import { DUMMY_TOKEN, mockSiteverify, postIntake, randomPhone } from './intake-helpers'

// Contract (FLW-202, ADR 0002): the quote form's and the estimator's real payloads are accepted, every field they
// collect lands on the Lead, its `form` activity or the Estimate snapshot, and the site reads the reply as success.

beforeEach(() => {
  mockSiteverify()
})
afterEach(() => vi.restoreAllMocks())

const ctx = (submissionKey = crypto.randomUUID()) => ({
  submissionKey,
  turnstileToken: DUMMY_TOKEN,
  href: 'https://turnersdecks.com/estimator?utm_source=google&utm_medium=cpc',
  referrer: 'https://www.google.com/',
  viewportWidth: 390,
})

/** The site's fetch, pointed at the real intake. */
const intakeFetch = async (_url: string, init?: RequestInit) => postIntake(JSON.parse(String(init!.body)))
const send = (payload: Parameters<typeof submitToCrm>[0]) => submitToCrm(payload, { baseUrl: 'https://crm.test', fetch: intakeFetch, sleep: async () => {} })

const leadOf = (phone: string) =>
  env.DB.prepare(
    `SELECT id, first_name, last_name, email, phone_e164, street, city, state, zip, service_type, message, source, attribution_json
     FROM leads WHERE phone_e164 = ?`,
  )
    .bind(`+1${phone}`)
    .first<Record<string, string>>()
const formActivity = (leadId: string) =>
  env.DB.prepare("SELECT body FROM lead_activity WHERE lead_id = ? AND kind = 'form'").bind(leadId).first<string>('body')

const ATTRIBUTION = JSON.stringify({
  utm_source: 'google',
  utm_medium: 'cpc',
  landing_page_url: 'https://turnersdecks.com/estimator?utm_source=google&utm_medium=cpc',
  referring_url: 'https://www.google.com/',
  device_type: 'mobile',
})

describe('the quote form', () => {
  const fields = (phone: string, website = ''): QuoteFields => ({
    first_name: 'Sam',
    last_name: 'Ray',
    email: `sam.${phone}@example.com`,
    phone,
    zip: '19518',
    project_type: 'Pool deck',
    approx_size: '16 x 20',
    material: 'Capped PVC',
    notes: 'Around an above-ground pool.',
    website,
  })

  it('becomes a mapped Lead with every field, and the site reads the reply as received', async () => {
    const phone = randomPhone()
    expect(await send(quotePayload(fields(phone), ctx()))).toEqual({ kind: 'received' })

    const lead = await leadOf(phone)
    expect(lead).toMatchObject({
      first_name: 'Sam',
      last_name: 'Ray',
      email: `sam.${phone}@example.com`,
      zip: '19518',
      service_type: 'Pool deck',
      message: 'Around an above-ground pool.',
      source: 'website',
      attribution_json: ATTRIBUTION,
    })
    const form = await formActivity(lead!.id)
    expect(form).toContain('Website form (quote_form)')
    expect(form).toContain('approx_size: 16 x 20')
    expect(form).toContain('material: Capped PVC')
  })

  it('a filled honeypot is a success for the bot and makes no Lead', async () => {
    const phone = randomPhone()
    expect(await send(quotePayload(fields(phone, 'https://spam.example'), ctx()))).toEqual({ kind: 'received' })
    expect(await leadOf(phone)).toBeNull()
  })
})

describe('the estimator', () => {
  const ANSWERS = {
    projectType: 'replacement', shape: 'rectangle', sections: [{ width: 20, depth: 16 }], attached: 'yes',
    height: 'low', layout: 'rectangle', slope: 'flat', access: 'standard', townhouse: 'no', zip: '19518',
    hoa: 'no', historic: 'no', material: 'standardComposite', railingSides: 'three', railingLf: 35,
    railingStyle: 'whiteVinyl', gates: '0', privacyWall: 'none', stairType: 'standard', stairCount: '1',
    stairRails: 'one', closedRisers: false, landing: 'none', demolition: 'full', fascia: 'standard',
    pattern: 'standard', skirting: 'none', lighting: 'none', features: [], neighbors: 'no',
  }
  const contact = (phone: string, website = ''): EstimatorContact => ({
    first_name: 'Jane',
    last_name: 'Doe',
    email: `jane.${phone}@example.com`,
    phone,
    zip: '19518',
    website,
    timing: 'Within 3 months',
    contact_method: 'text',
    wants_financing: true,
    notes: 'Back deck is rotting.',
    address: '12 Main St, Douglassville, PA',
  })

  /** A Published version whose material question defaults to standard composite. */
  async function publishWithDefault() {
    const doc = JSON.parse(JSON.stringify(SEED_DOCUMENT)) as EstimatorDocument
    doc.questions.find((q) => q.key === 'material')!.default = 'standardComposite'
    const next = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM estimator_versions').first<{ v: number }>()
    await env.DB.prepare('INSERT INTO estimator_versions (version, document_json, published_at) VALUES (?, ?, ?)').bind(next!.v, JSON.stringify(doc), Date.now()).run()
    return next!.v
  }

  it('is priced by the CRM; the Lead, its form activity and the Estimate snapshot hold every field', async () => {
    const phone = randomPhone()
    const version = await publishWithDefault()
    const out = await send(estimatorPayload(contact(phone), { version, answers: ANSWERS, defaulted: ['material', 'height'] }, ctx()))

    expect(out).toEqual({
      kind: 'estimate',
      result: { version, low: 38000, high: 47000, belowMinimum: false, needsReview: false, sqft: 320, railingLf: 35, serviceArea: 'primary' },
    })
    const lead = await leadOf(phone)
    expect(lead).toMatchObject({
      first_name: 'Jane',
      last_name: 'Doe',
      email: `jane.${phone}@example.com`,
      street: '12 Main St',
      city: 'Douglassville',
      state: 'PA',
      zip: '19518',
      service_type: 'Full deck replacement',
      message: 'Back deck is rotting.',
      attribution_json: ATTRIBUTION,
    })
    const form = await formActivity(lead!.id)
    expect(form).toContain('Website form (estimator)')
    expect(form).toContain(`estimate: $38,000 to $47,000 (Published version ${version})`)
    expect(form).toContain('timing: Within 3 months')
    expect(form).toContain('contact_method: text')
    expect(form).toContain('wants_financing: true')

    const snap = await env.DB.prepare('SELECT * FROM estimate_snapshots WHERE lead_id = ?').bind(lead!.id).first<Record<string, any>>()
    expect(snap).toMatchObject({ version, low: 38000, high: 47000, sqft: 320, service_area: 'primary' })
    // Every answer sent is stored (the CRM adds `false` for the unshown skirting door toggle).
    expect(JSON.parse(snap!.answers_json)).toEqual({ ...ANSWERS, skirtingDoor: false })
    // Only a shown question still on its version's default counts; height has no default.
    expect(JSON.parse(snap!.defaulted_json)).toEqual(['material'])
  })

  it('the raw reply parses with the site’s result validator', async () => {
    const res = await postIntake(estimatorPayload(contact(randomPhone()), { version: 1, answers: ANSWERS, defaulted: [] }, ctx()))
    const json = await res.json<{ ok: boolean; success: boolean; estimate: unknown }>()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, success: true })
    expect(parsePublicResult(json.estimate)).toMatchObject({ version: 1, low: 38000, high: 47000 })
  })

  it('a refused answer comes back to the site with the question named', async () => {
    const err = await send(estimatorPayload(contact(randomPhone()), { version: 1, answers: { ...ANSWERS, material: 'gold' }, defaulted: [] }, ctx())).catch((e) => e)
    expect(err).toMatchObject({ code: 'invalid_answers' })
    expect(err.errors).toHaveProperty('material')
  })

  it('a retry with the same submission key gets the identical price', async () => {
    const payload = estimatorPayload(contact(randomPhone()), { version: 1, answers: ANSWERS, defaulted: [] }, ctx())
    const first = await send(payload)
    expect(await send({ ...payload, turnstile_token: 'already-used' })).toEqual(first)
  })

  it('a filled honeypot is received with no estimate and makes no Lead', async () => {
    const phone = randomPhone()
    expect(await send(estimatorPayload(contact(phone, 'spam'), { version: 1, answers: ANSWERS, defaulted: [] }, ctx()))).toEqual({ kind: 'received' })
    expect(await leadOf(phone)).toBeNull()
  })
})
