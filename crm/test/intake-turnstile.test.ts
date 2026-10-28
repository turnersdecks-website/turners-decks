import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleIntake } from '#/lib/intake'
import { DUMMY_TOKEN, intakeRequest, mockSiteverify, postIntake, inspectionFormPayload, randomPhone, siteverifyCalls } from './intake-helpers'

afterEach(() => vi.restoreAllMocks())

const REAL_SECRET = '0x4AAAAAAAreal-staging-secret'
const productionEnv = { ...env, ENVIRONMENT: 'production', TURNSTILE_SECRET_KEY: REAL_SECRET }

const fresh = (overrides: Record<string, unknown> = {}) =>
  inspectionFormPayload({ phone: randomPhone(), email: `${crypto.randomUUID()}@example.com`, ...overrides })

async function storedSubmissions(phoneDigits: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM form_submissions WHERE raw_body LIKE ?`)
    .bind(`%${phoneDigits}%`)
    .first<{ n: number }>()
  return row?.n
}

describe('development mode (Cloudflare dummy keys)', () => {
  it('a submission with the dummy token passes siteverify and becomes a Lead', async () => {
    const spy = mockSiteverify()
    const res = await postIntake(fresh())

    expect(res.status).toBe(200)
    expect(siteverifyCalls(spy)).toBe(1)
  })

  it('a submission with no Turnstile token is refused and not stored', async () => {
    mockSiteverify()
    const phone = randomPhone()
    const res = await postIntake(fresh({ phone, turnstile_token: undefined }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ ok: false, success: false, error: 'turnstile_failed' })
    expect(await storedSubmissions(phone)).toBe(0)
  })

  it('a token siteverify refuses is refused', async () => {
    mockSiteverify(() => ({ success: false, 'error-codes': ['invalid-input-response'] }))
    const res = await postIntake(fresh())

    expect(res.status).toBe(403)
  })
})

describe('production mode', () => {
  const realAnswer = (over: Record<string, unknown> = {}) => () => ({
    success: true,
    hostname: 'turnersdecks.com',
    action: 'intake',
    ...over,
  })

  it('accepts a token siteverify confirms for an allowed hostname and the intake action', async () => {
    mockSiteverify(realAnswer())
    const res = await handleIntake(intakeRequest(fresh({ turnstile_token: 'real-token' })), productionEnv)

    expect(res.status).toBe(200)
  })

  it('refuses a missing token without calling siteverify', async () => {
    const spy = mockSiteverify(realAnswer())
    const res = await handleIntake(intakeRequest(fresh({ turnstile_token: undefined })), productionEnv)

    expect(res.status).toBe(403)
    expect(siteverifyCalls(spy)).toBe(0)
  })

  it('refuses the dummy token even if siteverify were to accept it', async () => {
    mockSiteverify(realAnswer())
    const res = await handleIntake(intakeRequest(fresh({ turnstile_token: DUMMY_TOKEN })), productionEnv)

    expect(res.status).toBe(403)
  })

  it('refuses everything when configured with a dummy secret', async () => {
    mockSiteverify(realAnswer())
    const res = await handleIntake(intakeRequest(fresh({ turnstile_token: 'real-token' })), {
      ...productionEnv,
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    })

    expect(res.status).toBe(403)
  })

  it('refuses a token issued for another hostname', async () => {
    mockSiteverify(realAnswer({ hostname: 'evil.example' }))
    const res = await handleIntake(intakeRequest(fresh({ turnstile_token: 'real-token' })), productionEnv)

    expect(res.status).toBe(403)
  })

  it('refuses a token issued for another action', async () => {
    mockSiteverify(realAnswer({ action: 'login' }))
    const res = await handleIntake(intakeRequest(fresh({ turnstile_token: 'real-token' })), productionEnv)

    expect(res.status).toBe(403)
  })

  it('refuses when siteverify cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const res = await handleIntake(intakeRequest(fresh({ turnstile_token: 'real-token' })), productionEnv)

    expect(res.status).toBe(403)
  })
})
