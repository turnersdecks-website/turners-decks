import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getEstimatorSettings, publishEstimatorDraft, saveEstimatorDraft, updateEstimateEmailTemplate } from '#/lib/estimator-settings.functions'
import { DEFAULT_ESTIMATE_EMAIL_TEMPLATE, renderTemplate } from '#/lib/estimator/email-template'
import type { EstimatorDocument } from '#/lib/estimator/document'
import { SEED_DOCUMENT } from '#/lib/estimator/seed'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// FLW-200: the owner's draft, Published versions and the Estimate email template.

type Settings = { draft: EstimatorDocument; revision: number; live: { version: number; publishedBy: string | null }; unpublished: boolean }

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const versionRow = (v: number) => env.DB.prepare('SELECT * FROM estimator_versions WHERE version = ?').bind(v).first<Record<string, unknown>>()
const read = async (cookie: string) => serverFnResult<Settings>(await callServerFn(getEstimatorSettings, cookie))

function withPrice(doc: EstimatorDocument, perLf: number) {
  const d = clone(doc)
  d.questions.find((q) => q.key === 'railingStyle')!.options!.find((o) => o.value === 'composite')!.price.perLf = perLf
  return d
}

describe('the seeded estimator', () => {
  it('starts with Published version 1 and a draft, both exactly the site’s former estimator', async () => {
    const v1 = await versionRow(1)
    expect(JSON.parse(String(v1!.document_json))).toEqual(SEED_DOCUMENT)
    const draft = await env.DB.prepare('SELECT document_json, revision FROM estimator_draft WHERE id = 1').first<{ document_json: string; revision: number }>()
    expect(JSON.parse(draft!.document_json)).toEqual(SEED_DOCUMENT)
    expect(draft!.revision).toBe(1)
  })

  it('starts with the default Estimate email template', async () => {
    const row = await env.DB.prepare('SELECT estimate_email_template AS t FROM company_settings WHERE id = 1').first<{ t: string }>()
    expect(row!.t).toBe(DEFAULT_ESTIMATE_EMAIL_TEMPLATE)
  })
})

// D1 is shared by the tests in this file, so each test works from the revision and version it finds.
describe('reading the estimator settings', () => {
  it('a staff-role Staff member sees the draft and the live version', async () => {
    const { cookie } = await signedInStaff('staff')
    const s = await read(cookie)
    expect(s.live.version).toBeGreaterThanOrEqual(1)
    expect(s.revision).toBeGreaterThanOrEqual(1)
    expect(s.draft.schemaVersion).toBe(1)
  })
})

describe('saving the draft', () => {
  it('a staff-role Staff member cannot save (403) and nothing changes', async () => {
    const { cookie } = await signedInStaff('staff')
    const before = await read(cookie)
    const res = await callServerFn(saveEstimatorDraft, cookie, { document: withPrice(SEED_DOCUMENT, 200), revision: before.revision })
    expect(res.status).toBe(403)
    expect((await read(cookie)).revision).toBe(before.revision)
  })

  it('an admin saves a new price; the live version is untouched until publishing', async () => {
    const { cookie } = await signedInStaff('admin')
    const before = await read(cookie)
    const res = await callServerFn(saveEstimatorDraft, cookie, { document: withPrice(SEED_DOCUMENT, 211), revision: before.revision })
    expect(await serverFnResult(res)).toEqual({ revision: before.revision + 1 })
    const s = await read(cookie)
    expect(s.unpublished).toBe(true)
    expect(s.live.version).toBe(before.live.version)
    expect(JSON.parse(String((await versionRow(1))!.document_json))).toEqual(SEED_DOCUMENT)
  })

  it('refuses invalid settings with a message on the field', async () => {
    const { cookie } = await signedInStaff('admin')
    const { revision } = await read(cookie)
    const res = await callServerFn(saveEstimatorDraft, cookie, { document: withPrice(SEED_DOCUMENT, -5), revision })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { fieldErrors: Record<string, string> }
    expect(Object.keys(body.fieldErrors).some((k) => k.endsWith('price.perLf'))).toBe(true)
  })

  it('refuses a save made from an older copy of the draft (409), keeping the newer one', async () => {
    const { cookie } = await signedInStaff('admin')
    const { revision } = await read(cookie)
    await callServerFn(saveEstimatorDraft, cookie, { document: withPrice(SEED_DOCUMENT, 222), revision })
    const stale = await callServerFn(saveEstimatorDraft, cookie, { document: withPrice(SEED_DOCUMENT, 300), revision })
    expect(stale.status).toBe(409)
    const s = await read(cookie)
    expect(s.draft.questions.find((q) => q.key === 'railingStyle')!.options!.find((o) => o.value === 'composite')!.price.perLf).toBe(222)
  })
})

describe('publishing', () => {
  it('a staff-role Staff member cannot publish (403)', async () => {
    const { cookie } = await signedInStaff('staff')
    const { revision, live } = await read(cookie)
    expect((await callServerFn(publishEstimatorDraft, cookie, { revision })).status).toBe(403)
    expect((await read(cookie)).live.version).toBe(live.version)
  })

  it('an admin publishes the reviewed draft as the next version; earlier versions never change', async () => {
    const { cookie } = await signedInStaff('admin', { name: 'Pat Turner' })
    const before = await read(cookie)
    await callServerFn(saveEstimatorDraft, cookie, { document: withPrice(SEED_DOCUMENT, 233), revision: before.revision })
    const first = before.live.version + 1
    expect(await serverFnResult(await callServerFn(publishEstimatorDraft, cookie, { revision: before.revision + 1 }))).toEqual({ version: first })

    await callServerFn(saveEstimatorDraft, cookie, { document: withPrice(SEED_DOCUMENT, 244), revision: before.revision + 1 })
    expect(await serverFnResult(await callServerFn(publishEstimatorDraft, cookie, { revision: before.revision + 2 }))).toEqual({ version: first + 1 })

    expect(JSON.parse(String((await versionRow(1))!.document_json))).toEqual(SEED_DOCUMENT)
    expect(JSON.parse(String((await versionRow(first))!.document_json))).toEqual(withPrice(SEED_DOCUMENT, 233))
    const s = await read(cookie)
    expect(s.live).toMatchObject({ version: first + 1, publishedBy: 'Pat Turner' })
    expect(s.unpublished).toBe(false)
  })

  it('refuses to publish a draft revision that is no longer current (409)', async () => {
    const { cookie } = await signedInStaff('admin')
    const before = await read(cookie)
    await callServerFn(saveEstimatorDraft, cookie, { document: withPrice(SEED_DOCUMENT, 255), revision: before.revision })
    const res = await callServerFn(publishEstimatorDraft, cookie, { revision: before.revision })
    expect(res.status).toBe(409)
    expect((await read(cookie)).live.version).toBe(before.live.version)
  })
})

describe('the Estimate email template', () => {
  it('an admin saves it; a staff-role Staff member cannot', async () => {
    const admin = await signedInStaff('admin')
    const staff = await signedInStaff('staff')
    const template = 'Subject: Your range, {first_name}\nHi {first_name}, about {low} to {high}.'
    expect((await callServerFn(updateEstimateEmailTemplate, staff.cookie, { template })).status).toBe(403)
    expect((await callServerFn(updateEstimateEmailTemplate, admin.cookie, { template })).status).toBe(200)
    const row = await env.DB.prepare('SELECT estimate_email_template AS t FROM company_settings WHERE id = 1').first<{ t: string }>()
    expect(row!.t).toBe(template)
  })

  it('must keep the range placeholders', async () => {
    const { cookie } = await signedInStaff('admin')
    expect((await callServerFn(updateEstimateEmailTemplate, cookie, { template: 'Hi {first_name}, thanks!' })).status).toBe(400)
  })

  it('fills placeholders, takes the subject from a first "Subject:" line, and leaves unknown ones as typed', () => {
    const { subject, body } = renderTemplate('Subject: Range for {first_name}\nHi {first_name}: {low}–{high} {mystery}', {
      first_name: 'Jane',
      low: '$38,000',
      high: '$47,000',
    })
    expect(subject).toBe('Range for Jane')
    expect(body).toBe('Hi Jane: $38,000–$47,000 {mystery}')
  })
})
