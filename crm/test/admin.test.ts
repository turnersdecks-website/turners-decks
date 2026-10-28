import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { listStaff } from '#/lib/staff.functions'
import { BASE, callServerFn, signedInStaff } from './staff'

// Admin functions (requireAdmin). Staff management grows in Slice 6.
const adminFns = { listStaff }

describe.each(Object.entries(adminFns))('admin function %s', (_name, fn) => {
  it('rejects a caller with no session', async () => {
    expect((await callServerFn(fn)).status).toBe(401)
  })

  it('rejects a signed-in staff-role Staff member', async () => {
    const { cookie } = await signedInStaff('staff')

    expect((await callServerFn(fn, cookie)).status).toBe(403)
  })

  it('allows an admin', async () => {
    const { cookie } = await signedInStaff('admin')

    expect((await callServerFn(fn, cookie)).status).toBe(200)
  })
})

it('an admin sees every Staff member with their role', async () => {
  const staff = await signedInStaff('staff')
  const admin = await signedInStaff('admin')

  const res = await callServerFn(listStaff, admin.cookie)
  const body = await res.text()

  expect(body).toContain(staff.email)
  expect(body).toContain(admin.email)
})

// Plan 006 S13: Better Auth's admin endpoints are not served at all, 404 for everyone (admins too: team.test.ts).
describe("Better Auth's admin endpoints", () => {
  const listUsers = (cookie?: string) =>
    SELF.fetch(`${BASE}/api/auth/admin/list-users`, { headers: cookie ? { cookie } : {} })

  it('reject a caller with no session', async () => {
    expect((await listUsers()).status).toBe(404)
  })

  it('reject a staff-role Staff member', async () => {
    const { cookie } = await signedInStaff('staff')

    expect((await listUsers(cookie)).status).toBe(404)
  })

  it('reject a staff-role Staff member making themself admin', async () => {
    const { cookie } = await signedInStaff('staff')
    const me = await (await SELF.fetch(`${BASE}/api/auth/get-session`, { headers: { cookie } })).json<{
      user: { id: string }
    }>()

    const res = await SELF.fetch(`${BASE}/api/auth/admin/set-role`, {
      method: 'POST',
      headers: { cookie, origin: BASE, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: me.user.id, role: 'admin' }),
    })

    expect(res.status).toBe(404)
  })
})
