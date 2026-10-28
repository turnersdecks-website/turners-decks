import { SELF, env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLead, getLead, moveLeadStage } from '#/lib/leads.functions'
import { mockSiteverify, postIntake, inspectionFormPayload } from './intake-helpers'
import { insertLead, staffIdOf, stageChanges } from './lead-helpers'
import { BASE, callServerFn, serverFnResult, signedInStaff } from './staff'

afterEach(() => vi.restoreAllMocks())

const createdAt = (id: string) => env.DB.prepare('SELECT created_at FROM leads WHERE id = ?').bind(id).first<number>('created_at')

// Stage history: every Pipeline stage write records one lead_stage_changes row in the same batch, and only when the
// stage actually changed.

describe('manual stage moves', () => {
  it('records one change from the old stage, by the Staff member who moved it', async () => {
    const { cookie, email } = await signedInStaff('staff')
    const id = await insertLead({ stage: 'contacted' })

    expect((await callServerFn(moveLeadStage, cookie, { leadId: id, stage: 'won' })).status).toBe(200)

    expect(await stageChanges(id)).toEqual([
      { from_stage: 'contacted', to_stage: 'won', changed_at: expect.any(Number), changed_by: await staffIdOf(email), reason: null },
    ])
  })

  it('moving a Lead to the stage it is already at records nothing', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead({ stage: 'quoted' })

    await callServerFn(moveLeadStage, cookie, { leadId: id, stage: 'quoted' })

    expect(await stageChanges(id)).toEqual([])
  })
})

describe('a new Lead starts its history at new', () => {
  it('a site form submission: one change from nothing to new at the time received; a repeat submission adds none', async () => {
    mockSiteverify()
    const phone = `610555${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`
    const { lead_id } = await (await postIntake(inspectionFormPayload({ phone }))).json<{ lead_id: string }>()
    await postIntake(inspectionFormPayload({ phone }))

    expect(await stageChanges(lead_id)).toEqual([
      { from_stage: null, to_stage: 'new', changed_at: await createdAt(lead_id), changed_by: null, reason: 'Website form' },
    ])
  })

  it('a Lead added by hand: one change, by the Staff member who added it', async () => {
    const { cookie, email } = await signedInStaff('staff')
    const { id } = await serverFnResult<{ id: string }>(await callServerFn(createLead, cookie, { firstName: 'Nora', lastName: 'Byhand' }))

    expect(await stageChanges(id)).toEqual([
      { from_stage: null, to_stage: 'new', changed_at: await createdAt(id), changed_by: await staffIdOf(email), reason: 'Added by hand' },
    ])
  })
})

describe('the Lead page shows its stage history', () => {
  it('getLead returns the changes newest first, with who made them', async () => {
    const { cookie } = await signedInStaff('staff', { name: 'Pat' })
    const id = await insertLead()
    await callServerFn(moveLeadStage, cookie, { leadId: id, stage: 'contacted' })
    await callServerFn(moveLeadStage, cookie, { leadId: id, stage: 'won' })

    const { stageHistory } = await serverFnResult<{ stageHistory: { fromStage: string | null; toStage: string; changedByName: string | null; changedAt: Date }[] }>(
      await callServerFn(getLead, cookie, { leadId: id }),
    )

    expect(stageHistory.map((c) => [c.fromStage, c.toStage, c.changedByName])).toEqual([
      ['contacted', 'won', 'Pat'],
      ['new', 'contacted', 'Pat'],
    ])
  })

  it('the activity area lists each move compactly', async () => {
    const { cookie } = await signedInStaff('staff', { name: 'Pat' })
    const id = await insertLead()
    await callServerFn(moveLeadStage, cookie, { leadId: id, stage: 'contacted' })

    const html = await (await SELF.fetch(`${BASE}/leads/${id}`, { headers: { cookie } })).text()

    expect(html).toMatch(/Moved to Contacted · [A-Z][a-z]{2} \d{1,2}(<!-- -->)? by (<!-- -->)?Pat/)
  })
})
