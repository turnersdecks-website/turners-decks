import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { assignLead, listAssignableStaff } from '#/lib/leads.functions'
import { CREATED_AT, insertLead, leadRow } from './lead-helpers'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// Assigning a Lead to a Staff member.

const staffId = async (email: string) => (await env.DB.prepare('SELECT id FROM user WHERE email = ?').bind(email).first<{ id: string }>())!.id

describe('assigning a Lead', () => {
  it('a staff-role Staff member assigns a Lead to another Staff member, then unassigns it', async () => {
    const { cookie } = await signedInStaff('staff')
    const other = await signedInStaff('staff')
    const id = await insertLead()

    expect((await callServerFn(assignLead, cookie, { leadId: id, staffId: await staffId(other.email) })).status).toBe(200)
    expect(await leadRow(id)).toMatchObject({ assigned_to: await staffId(other.email) })
    expect((await leadRow(id))?.updated_at).toBeGreaterThan(CREATED_AT)

    await callServerFn(assignLead, cookie, { leadId: id, staffId: null })
    expect((await leadRow(id))?.assigned_to).toBeNull()
  })

  it('refuses someone who is not a Staff member (400)', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    expect((await callServerFn(assignLead, cookie, { leadId: id, staffId: crypto.randomUUID() })).status).toBe(400)
  })

  it('refuses a banned Staff member (400)', async () => {
    const { cookie } = await signedInStaff('staff')
    const removed = await signedInStaff('staff')
    await env.DB.prepare('UPDATE user SET banned = 1 WHERE email = ?').bind(removed.email).run()
    const id = await insertLead()

    expect((await callServerFn(assignLead, cookie, { leadId: id, staffId: await staffId(removed.email) })).status).toBe(400)
  })

  it('the assignee list shows active Staff members to a staff-role caller (no emails needed)', async () => {
    const { cookie, email } = await signedInStaff('staff')

    const list = await serverFnResult<{ id: string; name: string }[]>(await callServerFn(listAssignableStaff, cookie))

    expect(list).toContainEqual({ id: await staffId(email), name: 'Test Staff' })
  })
})
