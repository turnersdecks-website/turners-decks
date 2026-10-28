import { expect, it } from 'vitest'
import { limitAuthRequest } from '#/lib/auth-rate-limit'
import { BASE } from './staff'

// Plan 010 F1: Staff sign-in and password-reset requests are limited per IP and per email (5 a minute each).

function fakeLimiter(limit = 5) {
  const counts = new Map<string, number>()
  return {
    async limit({ key }: { key: string }) {
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      return { success: n <= limit }
    },
  } as unknown as RateLimit
}

const post = (path: string, body: unknown, { ip = '203.0.113.1', type = 'application/json' } = {}) =>
  new Request(`${BASE}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': type, 'cf-connecting-ip': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

async function statuses(env: { AUTH_RATE_LIMITER: RateLimit }, requests: Request[]) {
  const out: (number | null)[] = []
  for (const r of requests) out.push((await limitAuthRequest(env, r))?.status ?? null)
  return out
}

it('the 6th sign-in for one email in a minute is refused, even from new IPs', async () => {
  const env = { AUTH_RATE_LIMITER: fakeLimiter() }
  const tries = Array.from({ length: 6 }, (_, i) => post('sign-in/email', { email: 'Sam@Example.com ', password: 'x' }, { ip: `198.51.100.${i}` }))
  const result = await statuses(env, tries)
  expect(result).toEqual([null, null, null, null, null, 429])
})

it('the 6th sign-in or reset from one IP in a minute is refused, across different emails', async () => {
  const env = { AUTH_RATE_LIMITER: fakeLimiter() }
  const tries = Array.from({ length: 6 }, (_, i) =>
    post(i % 2 ? 'request-password-reset' : 'sign-in/email', { email: `staff${i}@example.com`, password: 'x' }),
  )
  expect(await statuses(env, tries)).toEqual([null, null, null, null, null, 429])
  const refused = await limitAuthRequest(env, post('sign-in/email', { email: 'new@example.com', password: 'x' }))
  expect(refused!.headers.get('retry-after')).toBe('60')
  expect(await refused!.json()).toEqual({ code: 'RATE_LIMITED' })
})

it('other auth requests are never limited', async () => {
  const env = { AUTH_RATE_LIMITER: fakeLimiter(0) }
  expect(await limitAuthRequest(env, new Request(`${BASE}/api/auth/get-session`))).toBeNull()
  expect(await limitAuthRequest(env, post('sign-out', {}))).toBeNull()
  expect(await limitAuthRequest(env, post('reset-password', { token: 't', newPassword: 'p' }))).toBeNull()
})

it('a form-encoded sign-in is refused, so the email limit cannot be skipped', async () => {
  const env = { AUTH_RATE_LIMITER: fakeLimiter() }
  const res = await limitAuthRequest(env, post('sign-in/email', 'email=a%40example.com&password=x', { type: 'application/x-www-form-urlencoded' }))
  expect(res!.status).toBe(415)
})

it('a broken limiter lets requests through', async () => {
  const env = { AUTH_RATE_LIMITER: { limit: () => Promise.reject(new Error('down')) } as unknown as RateLimit }
  expect(await limitAuthRequest(env, post('sign-in/email', { email: 'a@example.com', password: 'x' }))).toBeNull()
})
