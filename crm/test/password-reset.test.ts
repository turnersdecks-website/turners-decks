import { SELF, env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { createAuth } from '#/lib/auth'
import type { Email } from '#/lib/email'
import { BASE } from './staff'

function authWithOutbox() {
  const sent: Email[] = []
  const auth = createAuth(env, { sendEmail: async (email) => void sent.push(email) })
  return { auth, sent }
}

const signIn = (email: string, password: string) =>
  SELF.fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password }),
  })

it('a Staff member resets a forgotten password from the emailed link', async () => {
  const { auth, sent } = authWithOutbox()
  const email = `reset-${crypto.randomUUID()}@example.com`
  await auth.api.createUser({ body: { email, password: 'old password 123', name: 'Sam' } })

  await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } })

  expect(sent).toHaveLength(1)
  expect(sent[0].to).toBe(email)
  const link = sent[0].text.match(/https?:\/\/\S+/)![0]

  // The emailed link lands on the reset page with a token.
  const landing = await SELF.fetch(link, { redirect: 'manual' })
  const resetPage = new URL(landing.headers.get('location')!, BASE)
  expect(resetPage.pathname).toBe('/reset-password')
  const token = resetPage.searchParams.get('token')!

  const reset = await SELF.fetch(`${BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ token, newPassword: 'new password 456' }),
  })
  expect(reset.status).toBe(200)

  expect((await signIn(email, 'new password 456')).status).toBe(200)
  expect((await signIn(email, 'old password 123')).status).toBe(401)
})

it('a reset request for an unknown email sends nothing', async () => {
  const { auth, sent } = authWithOutbox()

  await auth.api.requestPasswordReset({ body: { email: 'nobody@example.com', redirectTo: '/reset-password' } })

  expect(sent).toHaveLength(0)
})

it('a password reset signs the Staff member out everywhere', async () => {
  const { auth, sent } = authWithOutbox()
  const email = `revoke-${crypto.randomUUID()}@example.com`
  await auth.api.createUser({ body: { email, password: 'old password 123', name: 'Pat' } })
  const oldCookie = (await signIn(email, 'old password 123')).headers.get('set-cookie')!.split(';')[0]

  await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } })
  const token = new URL(sent[0].text.match(/https?:\/\/\S+/)![0]).pathname.split('/').pop()!
  await auth.api.resetPassword({ body: { token, newPassword: 'new password 456' } })

  const session = await SELF.fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: oldCookie } })
  expect(await session.json()).toBeNull()
})

// Plan 010 F5: a reset request for a real account answers without waiting for its email to be queued, so response
// time does not tell an attacker which emails are Staff accounts. Invites (staffSetup) still wait.
it('a password reset request answers before its email is queued', async () => {
  let queued = false
  const never = new Promise<void>(() => {})
  const auth = createAuth(env, { sendEmail: () => never.then(() => void (queued = true)) })
  const email = `reset-bg-${crypto.randomUUID()}@example.com`
  await auth.api.createUser({ body: { email, password: 'old password 123', name: 'Sam' } })

  const answered = await Promise.race([
    auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } }).then(() => 'answered'),
    new Promise((r) => setTimeout(() => r('waited'), 1000)),
  ])

  expect(answered).toBe('answered')
  expect(queued).toBe(false)
})
