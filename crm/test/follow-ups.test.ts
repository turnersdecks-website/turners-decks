import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { setFollowUpDone } from '#/lib/followups.functions'
import { addLeadActivity } from '#/lib/leads.functions'
import { insertLead } from './lead-helpers'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// Follow-ups (GLOSSARY): dated reminders for Staff to contact a Lead again, done or not done.

const DUE = Date.UTC(2026, 9, 20, 14, 0)

async function followUp(cookie: string, body = 'Call back about the quote') {
  const leadId = await insertLead({ firstName: 'Fran', lastName: 'Followup' })
  const { id } = await serverFnResult<{ id: string }>(await callServerFn(addLeadActivity, cookie, { leadId, kind: 'note', body, followUpAt: DUE }))
  return { leadId, activityId: id }
}

const doneAt = async (id: string) =>
  (await env.DB.prepare('SELECT follow_up_done_at AS t FROM lead_activity WHERE id = ?').bind(id).first<{ t: number | null }>())?.t

describe('completing a Follow-up', () => {
  it('a staff-role Staff member marks a Follow-up done', async () => {
    const { cookie } = await signedInStaff('staff')
    const { activityId } = await followUp(cookie)
    const before = Date.now()

    const res = await callServerFn(setFollowUpDone, cookie, { activityId, done: true })

    expect(res.status).toBe(200)
    expect(await doneAt(activityId)).toBeGreaterThanOrEqual(before)
  })

  it('a done Follow-up can be reopened', async () => {
    const { cookie } = await signedInStaff('staff')
    const { activityId } = await followUp(cookie)

    await callServerFn(setFollowUpDone, cookie, { activityId, done: true })
    await callServerFn(setFollowUpDone, cookie, { activityId, done: false })

    expect(await doneAt(activityId)).toBeNull()
  })

  it('answers 404 for activity that has no Follow-up date', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead()
    const { id } = await serverFnResult<{ id: string }>(await callServerFn(addLeadActivity, cookie, { leadId, kind: 'note', body: 'plain note' }))

    expect((await callServerFn(setFollowUpDone, cookie, { activityId: id, done: true })).status).toBe(404)
    expect(await doneAt(id)).toBeNull()
  })
})
