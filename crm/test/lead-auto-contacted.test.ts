import { describe, expect, it } from 'vitest'
import { addLeadActivity, moveLeadStage } from '#/lib/leads.functions'
import { CREATED_AT, insertLead, leadRow, staffIdOf, stageChanges } from './lead-helpers'
import { callServerFn, signedInStaff } from './staff'

// Logging a call, email or text on a new Lead moves it to contacted (GLOSSARY "Pipeline stage"). Notes never move it.

const LOGS = {
  call: { kind: 'call', direction: 'outbound', outcome: 'Left voicemail' },
  email: { kind: 'email', body: 'Sent the inspection times' },
  text: { kind: 'text', body: 'Texted from my phone: on my way' },
} as const

describe('logging contact moves a new Lead to contacted', () => {
  it.each(Object.entries(LOGS))('logging a %s on a new Lead moves it to contacted; updated_at moves on', async (_kind, input) => {
    const { cookie, email } = await signedInStaff('staff')
    const id = await insertLead()

    const res = await callServerFn(addLeadActivity, cookie, { leadId: id, ...input })

    expect(res.status).toBe(200)
    const lead = await leadRow(id)
    expect(lead?.stage).toBe('contacted')
    expect(lead?.updated_at).toBeGreaterThan(CREATED_AT)
    expect(await stageChanges(id)).toEqual([
      { from_stage: 'new', to_stage: 'contacted', changed_at: lead?.updated_at, changed_by: await staffIdOf(email), reason: `${_kind[0].toUpperCase()}${_kind.slice(1)} logged` },
    ])
  })

  it('a note leaves a new Lead at new', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    await callServerFn(addLeadActivity, cookie, { leadId: id, kind: 'note', body: 'Drove past, big maple over the garage' })

    expect(await leadRow(id)).toMatchObject({ stage: 'new', updated_at: CREATED_AT })
    expect(await stageChanges(id)).toEqual([])
  })

  it.each(['contacted', 'appointment', 'quoted', 'won', 'lost'])('a Lead already at %s is untouched by a logged call, email or text', async (stage) => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead({ stage })

    for (const input of Object.values(LOGS)) await callServerFn(addLeadActivity, cookie, { leadId: id, ...input })

    expect(await leadRow(id)).toMatchObject({ stage, updated_at: CREATED_AT })
    expect(await stageChanges(id)).toEqual([])
  })

  it('a stage move racing a logged call never loses the newer stage', async () => {
    const { cookie } = await signedInStaff('staff')
    const ids = await Promise.all(Array.from({ length: 5 }, () => insertLead()))

    await Promise.all(
      ids.flatMap((id) => [
        callServerFn(moveLeadStage, cookie, { leadId: id, stage: 'appointment' }),
        callServerFn(addLeadActivity, cookie, { leadId: id, ...LOGS.call }),
      ]),
    )
    // The log landing after the move must not drag the Lead back to contacted.
    for (const id of ids) await callServerFn(addLeadActivity, cookie, { leadId: id, ...LOGS.text })

    for (const id of ids) expect((await leadRow(id))?.stage).toBe('appointment')
    // Whatever the order, the history ends at the stage the Lead is at.
    for (const id of ids) expect((await stageChanges(id)).at(-1)?.to_stage).toBe('appointment')
  })
})
