import { afterEach, expect, it, vi } from 'vitest'
import { mockSiteverify, postIntake, inspectionFormPayload, randomIp, randomPhone } from './intake-helpers'

afterEach(() => vi.restoreAllMocks())

// wrangler.jsonc: INTAKE_RATE_LIMITER allows 10 requests per 60 s per key (the client IP).
it('an IP that posts more than 10 times a minute is throttled; other IPs are not', async () => {
  mockSiteverify()
  const ip = randomIp()
  const statuses: number[] = []
  for (let i = 0; i < 11; i++) {
    statuses.push((await postIntake(inspectionFormPayload({ phone: randomPhone(), email: '' }), { ip })).status)
  }

  expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
  expect(statuses[10]).toBe(429)
  const other = await postIntake(inspectionFormPayload({ phone: randomPhone(), email: '' }), { ip: randomIp() })
  expect(other.status).toBe(200)
})
