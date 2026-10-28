import { describe, expect, it } from 'vitest'
import { createLead, listPipeline, moveLeadStage } from '#/lib/leads.functions'
import { CREATED_AT, insertLead, leadRow } from './lead-helpers'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// Pipeline board: Staff move a Lead between Pipeline stages (GLOSSARY: new, contacted, appointment, quoted, won, lost).

describe('moving a Lead to another Pipeline stage', () => {
  it('a staff-role Staff member moves a Lead from new to contacted; updated_at moves on', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    const res = await callServerFn(moveLeadStage, cookie, { leadId: id, stage: 'contacted' })

    expect(res.status).toBe(200)
    const lead = await leadRow(id)
    expect(lead?.stage).toBe('contacted')
    expect(lead?.updated_at).toBeGreaterThan(CREATED_AT)
  })

  it('moving does not touch first-contact fields', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    await callServerFn(moveLeadStage, cookie, { leadId: id, stage: 'won' })

    expect(await leadRow(id)).toMatchObject({
      source: 'website',
      first_source: 'website',
      first_touch_json: '{"landing_page":"/contact"}',
      created_at: CREATED_AT,
    })
  })

  it('refuses a stage that is not a Pipeline stage (400)', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    const res = await callServerFn(moveLeadStage, cookie, { leadId: id, stage: 'estimate_sent' })

    expect(res.status).toBe(400)
    expect((await leadRow(id))?.stage).toBe('new')
  })

  it('answers 404 for an unknown Lead', async () => {
    const { cookie } = await signedInStaff('staff')

    const res = await callServerFn(moveLeadStage, cookie, { leadId: crypto.randomUUID(), stage: 'won' })

    expect(res.status).toBe(404)
  })
})

describe('the Pipeline board', () => {
  it('lists Leads with their Pipeline stage and assignee', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead({ firstName: 'Bea', stage: 'quoted' })

    const board = await serverFnResult<{ id: string; firstName: string; stage: string; assigneeName: string | null }[]>(
      await callServerFn(listPipeline, cookie),
    )

    expect(board.find((l) => l.id === id)).toMatchObject({ firstName: 'Bea', stage: 'quoted', assigneeName: null })
  })
})

describe('adding a Lead by hand', () => {
  it('creates a new-stage Lead whose Source and first Source are manual', async () => {
    const { cookie } = await signedInStaff('staff')

    const res = await callServerFn(createLead, cookie, {
      firstName: 'Walt',
      lastName: 'Walkin',
      email: '',
      phone: '610 555 0177',
      street: '',
      city: 'Boyertown',
      state: 'PA',
      zip: '',
      serviceType: 'Roof inspection',
      message: '',
    })

    const { id } = await serverFnResult<{ id: string }>(res)
    expect(await leadRow(id)).toMatchObject({
      first_name: 'Walt',
      phone_e164: '+16105550177',
      stage: 'new',
      source: 'manual',
      first_source: 'manual',
      first_touch_json: null,
    })
  })
})
