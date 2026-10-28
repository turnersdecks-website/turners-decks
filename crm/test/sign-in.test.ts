import { SELF, env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { createAuth } from '#/lib/auth'

const BASE = 'http://localhost'

async function seedStaff(email: string, password: string) {
  // Public sign-up is off; Staff are created server-side (admin plugin).
  await createAuth(env).api.createUser({
    body: { email, password, name: 'Pat' },
  })
}

function signIn(email: string, password: string) {
  return SELF.fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password }),
  })
}

it('Staff member signs in with email and password and gets a session', async () => {
  await seedStaff('jeff@example.com', 'correct horse battery')

  const res = await signIn('jeff@example.com', 'correct horse battery')

  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')
  expect(cookie).toContain('better-auth.session_token=')

  const sessionRes = await SELF.fetch(`${BASE}/api/auth/get-session`, {
    headers: { cookie: cookie!.split(';')[0] },
  })
  const session = await sessionRes.json<{ user: { email: string; role: string } }>()
  expect(session.user).toMatchObject({ email: 'jeff@example.com', role: 'staff' })
})

it('rejects a wrong password', async () => {
  await seedStaff('sam@example.com', 'correct horse battery')

  const res = await signIn('sam@example.com', 'wrong password!!')

  expect(res.status).toBe(401)
})

it('public sign-up is off', async () => {
  const res = await SELF.fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: 'x@example.com', password: 'whatever123', name: 'X' }),
  })

  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' })
})

it('Staff member and session get crypto.randomUUID() ids (PLAN: IDs are UUID text)', async () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  await seedStaff('rachel@example.com', 'correct horse battery')

  const res = await signIn('rachel@example.com', 'correct horse battery')
  const cookie = res.headers.get('set-cookie')!.split(';')[0]
  const sessionRes = await SELF.fetch(`${BASE}/api/auth/get-session`, {
    headers: { cookie },
  })
  const { user, session } = await sessionRes.json<{
    user: { id: string }
    session: { id: string; userId: string }
  }>()

  expect(user.id).toMatch(UUID)
  expect(session.id).toMatch(UUID)
  expect(session.userId).toBe(user.id)
})
