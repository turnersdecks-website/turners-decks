import { SELF, env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EstimateSnapshotView } from '#/lib/estimate-snapshots.functions'
import { listEstimateSnapshots } from '#/lib/estimate-snapshots.functions'
import { ESTIMATOR_ANSWERS, estimatorPayload, mockSiteverify, postIntake, randomPhone } from './intake-helpers'
import { insertLead } from './lead-helpers'
import { BASE, callServerFn, serverFnResult, signedInStaff } from './staff'

// FLW-203: the Lead page's Estimate tab lists the Lead's Estimate snapshots, as the Homeowner saw them.

beforeEach(() => {
  mockSiteverify()
})
afterEach(() => vi.restoreAllMocks())

/** Two estimator Form submissions from one Homeowner (one Lead): the second one, a day later, is flagged. */
async function leadWithTwoEstimates() {
  const phone = randomPhone()
  const first = await (await postIntake(estimatorPayload({ phone }))).json<{ lead_id: string }>()
  await postIntake(estimatorPayload({ phone, answers: { ...ESTIMATOR_ANSWERS, height: 'high' }, defaulted: [] }))
  // Make the order unambiguous: the first snapshot is a day older.
  await env.DB.prepare(
    `UPDATE estimate_snapshots SET created_at = created_at - 86400000
     WHERE lead_id = ? AND id = (SELECT id FROM estimate_snapshots WHERE lead_id = ? AND flags_json = '[]')`,
  )
    .bind(first.lead_id, first.lead_id)
    .run()
  return first.lead_id
}

const list = async (cookie: string, leadId: string) => serverFnResult<EstimateSnapshotView[]>(await callServerFn(listEstimateSnapshots, cookie, { leadId }))

const page = async (path: string, cookie: string) => {
  const res = await SELF.fetch(`${BASE}${path}`, { headers: { cookie } })
  expect(res.status).toBe(200)
  return res.text()
}

describe('listing a Lead’s Estimate snapshots', () => {
  it('a staff-role Staff member sees every snapshot on the Lead, newest first, with what the Homeowner saw', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await leadWithTwoEstimates()

    const snaps = await list(cookie, leadId)

    expect(snaps).toHaveLength(2)
    expect(snaps[0]!.createdAt).toBeGreaterThan(snaps[1]!.createdAt)
    expect(snaps[0]!.flags).toEqual(['Deck more than 10 feet high'])
    expect(snaps[1]).toMatchObject({ version: 1, low: 38000, mid: 42285, high: 47000, flags: [], serviceArea: 'primary', sqft: 320 })
    expect(snaps[1]!.answers.material).toBe('standardComposite')
    expect(snaps[1]!.questions.material!.options!.find((o) => o.value === 'standardComposite')!.label).toBe('Standard composite')
    expect(snaps[1]!.lineItems.platform).toBeGreaterThan(0)
  })

  it('is empty for a Lead that never used the estimator', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ firstName: 'No', lastName: 'Estimate' })

    expect(await list(cookie, leadId)).toEqual([])
  })
})

describe('the Estimate tab on the Lead page', () => {
  it('shows each snapshot’s date, Published version, range, midpoint, flags, answers in words and line items', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await leadWithTwoEstimates()

    const html = await page(`/leads/${leadId}?tab=estimate`, cookie)

    expect(html.match(/data-slot="estimate-snapshot"/g)).toHaveLength(2)
    expect(html).toContain('Published version <!-- -->1')
    expect(html).toMatch(/\$38,000<!-- --> – <!-- -->\$47,000/)
    expect(html).toContain('$42,285')
    expect(html).toContain('Needs site review')
    expect(html).toContain('Deck more than 10 feet high')
    // Answers use the labels the Homeowner saw, not the stored values.
    expect(html).toContain('Which decking material?')
    expect(html).toContain('Standard composite')
    expect(html).toContain('Full deck replacement')
    expect(html).toContain('20 × 16 ft')
    expect(html).toMatch(/Which decking material\?<\/dt><dd[^>]*>Standard composite<\/dd>/)
    // Line items.
    expect(html).toContain('Deck platform')
    expect(html).toContain('Permit allowance')
    // The flagged (newer) snapshot comes first.
    expect(html.indexOf('Deck more than 10 feet high')).toBeLessThan(html.indexOf('No site-review flags'))
  })

  it('marks answers the Homeowner left on their default', async () => {
    const { cookie } = await signedInStaff('admin')
    const phone = randomPhone()
    // Published version with a default for the neighbors question.
    const doc = JSON.parse(
      String((await env.DB.prepare('SELECT document_json FROM estimator_versions WHERE version = 1').first<{ document_json: string }>())!.document_json),
    ) as { questions: { key: string; default: string | null }[] }
    doc.questions.find((q) => q.key === 'neighbors')!.default = 'no'
    const next = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM estimator_versions').first<{ v: number }>()
    await env.DB.prepare('INSERT INTO estimator_versions (version, document_json, published_at) VALUES (?, ?, ?)').bind(next!.v, JSON.stringify(doc), Date.now()).run()
    const out = await (await postIntake(estimatorPayload({ phone, estimator_version: next!.v, defaulted: ['neighbors'] }))).json<{ lead_id: string }>()

    const html = await page(`/leads/${out.lead_id}?tab=estimate`, cookie)

    expect(html).toMatch(/considering a deck\?<\/dt><dd[^>]*>No<span[^>]*> \(default\)<\/span>/)
    expect(html).toMatch(/Which decking material\?<\/dt><dd[^>]*>Standard composite<\/dd>/)
  })

  it('says so when the Lead has no Estimate snapshots', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ firstName: 'Empty', lastName: 'Estimate' })

    const html = await page(`/leads/${leadId}?tab=estimate`, cookie)

    expect(html).toContain('No Estimate snapshots yet.')
  })
})
