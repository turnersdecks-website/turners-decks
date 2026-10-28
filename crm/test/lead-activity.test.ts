import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { addLeadActivity, getLead } from '#/lib/leads.functions'
import { insertLead } from './lead-helpers'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// Lead detail activity: Staff add notes (and log calls/emails), optionally with a Follow-up date.

type Activity = { kind: string; body: string | null; authorName: string | null; followUpAt: Date | null; outcome: string | null }

describe('adding a note to a Lead', () => {
  it('a staff-role Staff member adds a note; it shows on the Lead with its author, newest first', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    await callServerFn(addLeadActivity, cookie, { leadId: id, kind: 'note', body: 'Asked about metal roofing' })
    const res = await callServerFn(addLeadActivity, cookie, { leadId: id, kind: 'note', body: 'Prefers texts after 5pm' })

    expect(res.status).toBe(200)
    const { activity } = await serverFnResult<{ activity: Activity[] }>(await callServerFn(getLead, cookie, { leadId: id }))
    expect(activity.map((a) => [a.kind, a.body, a.authorName])).toEqual([
      ['note', 'Prefers texts after 5pm', 'Test Staff'],
      ['note', 'Asked about metal roofing', 'Test Staff'],
    ])
  })

  it('a note with a Follow-up date records when to contact the Lead again', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()
    const due = Date.UTC(2026, 9, 20, 14, 0)

    await callServerFn(addLeadActivity, cookie, { leadId: id, kind: 'note', body: 'Call back Tuesday', followUpAt: due })

    const row = await env.DB.prepare('SELECT follow_up_at, follow_up_done_at FROM lead_activity WHERE lead_id = ?').bind(id).first()
    expect(row).toEqual({ follow_up_at: due, follow_up_done_at: null })
  })

  it('logs a call with direction, outcome and minutes', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    await callServerFn(addLeadActivity, cookie, { leadId: id, kind: 'call', direction: 'outbound', outcome: 'Left voicemail', durationMin: 2, body: '' })

    const row = await env.DB.prepare('SELECT kind, direction, outcome, duration_min, body FROM lead_activity WHERE lead_id = ?').bind(id).first()
    expect(row).toEqual({ kind: 'call', direction: 'outbound', outcome: 'Left voicemail', duration_min: 2, body: null })
  })

  it.each([
    ['an empty note', { kind: 'note', body: '  ' }],
    ['a kind Staff cannot log by hand', { kind: 'form', body: 'x' }],
    ['a call direction that is not inbound/outbound', { kind: 'call', direction: 'sideways', outcome: 'Connected' }],
    ['a Follow-up date that is not a time', { kind: 'note', body: 'x', followUpAt: 'tomorrow' }],
  ])('refuses %s (400)', async (_what, input) => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    expect((await callServerFn(addLeadActivity, cookie, { leadId: id, ...input })).status).toBe(400)
  })

  it('answers 404 for an unknown Lead', async () => {
    const { cookie } = await signedInStaff('staff')

    expect((await callServerFn(addLeadActivity, cookie, { leadId: crypto.randomUUID(), kind: 'note', body: 'x' })).status).toBe(404)
    expect((await callServerFn(getLead, cookie, { leadId: crypto.randomUUID() })).status).toBe(404)
  })
})
