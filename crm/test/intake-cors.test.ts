import { SELF } from 'cloudflare:test'
import { afterEach, expect, it, vi } from 'vitest'
import { BASE, mockSiteverify, postIntake, inspectionFormPayload, randomPhone, siteverifyCalls } from './intake-helpers'

afterEach(() => vi.restoreAllMocks())

function preflight(origin: string) {
  return SELF.fetch(`${BASE}/api/public/intake`, {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  })
}

it('the preflight from a site origin is allowed without a session or Turnstile', async () => {
  const res = await preflight('http://localhost:4321')

  expect(res.status).toBe(204)
  expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:4321')
  expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type')
  expect(res.headers.get('vary')).toContain('Origin')
})

it('the preflight from any other origin is refused with no CORS headers', async () => {
  const res = await preflight('https://evil.example')

  expect(res.status).toBe(403)
  expect(res.headers.get('access-control-allow-origin')).toBeNull()
})

it('a submission from a site origin gets its CORS header back', async () => {
  mockSiteverify()
  const res = await postIntake(inspectionFormPayload({ phone: randomPhone(), email: '' }), { origin: 'https://turnersdecks.com' })

  expect(res.status).toBe(200)
  expect(res.headers.get('access-control-allow-origin')).toBe('https://turnersdecks.com')
})

it('a submission from any other origin is refused before Turnstile is redeemed', async () => {
  const spy = mockSiteverify()
  const res = await postIntake(inspectionFormPayload({ phone: randomPhone(), email: '' }), { origin: 'https://evil.example' })

  expect(res.status).toBe(403)
  expect(res.headers.get('access-control-allow-origin')).toBeNull()
  expect(siteverifyCalls(spy)).toBe(0)
})
