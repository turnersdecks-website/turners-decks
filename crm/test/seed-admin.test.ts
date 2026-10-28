import { SELF, env } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { createAuth } from '#/lib/auth'
import { seedFirstAdmin } from '#/lib/seed-admin'
import { BASE } from './staff'

const secrets = { SEED_ADMIN_EMAIL: 'Pat@TurnersDecks.com', SEED_ADMIN_PASSWORD: 'first admin password' }

// Storage is isolated per test file, so clearing Staff here touches no other file.
beforeEach(async () => {
  await env.DB.exec('DELETE FROM user')
})

async function signIn(email: string, password: string) {
  const res = await SELF.fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password }),
  })
  return { status: res.status, body: await res.json<{ user?: { email: string; role: string } }>() }
}

const staffCount = async () => (await env.DB.prepare('SELECT count(*) AS n FROM user').first<{ n: number }>())!.n

it('creates the first admin from the seed secrets', async () => {
  expect(await seedFirstAdmin({ ...env, ...secrets })).toBe('created')

  const res = await signIn('pat@turnersdecks.com', 'first admin password')
  expect(res.status).toBe(200)
  expect(res.body.user).toMatchObject({ email: 'pat@turnersdecks.com', role: 'admin' })
})

it('is idempotent: a second run changes nothing, not even the password', async () => {
  await seedFirstAdmin({ ...env, ...secrets })

  expect(await seedFirstAdmin({ ...env, ...secrets, SEED_ADMIN_PASSWORD: 'a different password' })).toBe('skipped')

  expect(await staffCount()).toBe(1)
  expect((await signIn(secrets.SEED_ADMIN_EMAIL, 'first admin password')).status).toBe(200)
})

it('does nothing once any admin exists', async () => {
  await createAuth(env).api.createUser({
    body: { email: 'sam@example.com', password: 'sam password 1', name: 'Sam', role: 'admin' },
  })

  expect(await seedFirstAdmin({ ...env, ...secrets })).toBe('skipped')

  expect(await staffCount()).toBe(1)
})

it('does nothing without both secrets', async () => {
  const unset = { SEED_ADMIN_EMAIL: undefined, SEED_ADMIN_PASSWORD: undefined }
  expect(await seedFirstAdmin({ ...env, ...unset, SEED_ADMIN_EMAIL: secrets.SEED_ADMIN_EMAIL })).toBe('skipped')
  expect(await seedFirstAdmin({ ...env, ...unset })).toBe('skipped')

  expect(await staffCount()).toBe(0)
})

it('the Worker seeds the first admin from its own secrets when someone signs in', async () => {
  // vitest.config.ts binds SEED_ADMIN_EMAIL=owner@example.com, SEED_ADMIN_PASSWORD=owner password 123.
  const res = await signIn('owner@example.com', 'owner password 123')

  expect(res.status).toBe(200)
  expect(res.body.user).toMatchObject({ role: 'admin' })
})
