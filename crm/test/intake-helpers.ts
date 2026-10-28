import { SELF } from 'cloudflare:test'
import { vi } from 'vitest'

export const BASE = 'http://localhost'
export const SITE_ORIGIN = 'https://turnersdecks.com'
/** What Cloudflare's dummy Turnstile site keys put in the widget. */
export const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** A random client IP, so each test has its own per-IP rate-limit bucket. */
export const randomIp = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`

/** Unique US phone (555-01xx style), so tests do not collide on the unique phone index. */
export const randomPhone = () => `610555${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`

// Same shape the site's inspection form sends (src/lib/crmIntake.ts > buildCrmPayload, full form variant).
export function inspectionFormPayload(overrides: Record<string, unknown> = {}) {
  return {
    source: 'inspection',
    name: 'Dana Whitcomb',
    email: 'Dana.Whitcomb@Example.com',
    phone: '(610) 555-0142',
    address: '12 Main St, Douglassville, PA 19518',
    projectType: 'Roof replacement',
    message: 'Shingles blew off in the storm.',
    website: '',
    utm_source: 'google',
    utm_medium: 'cpc',
    first_touch: JSON.stringify({ utm_source: 'facebook' }),
    landing_page_url: 'https://turnersdecks.com/contact?utm_source=google',
    referring_url: 'https://www.google.com/',
    submission_timestamp: '2026-10-13T12:00:00.000Z',
    device_type: 'mobile',
    turnstile_token: DUMMY_TOKEN,
    ...overrides,
  }
}

export function intakeRequest(body: unknown, opts: { ip?: string; origin?: string | null; method?: string } = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'cf-connecting-ip': opts.ip ?? randomIp(),
  }
  if (opts.origin !== null) headers.origin = opts.origin ?? SITE_ORIGIN
  return new Request(`${BASE}/api/public/intake`, {
    method: opts.method ?? 'POST',
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

export function postIntake(body: unknown, opts: { ip?: string; origin?: string | null } = {}) {
  return SELF.fetch(intakeRequest(body, opts))
}

type Siteverify = { success: boolean; hostname?: string; action?: string; 'error-codes'?: string[] }

/**
 * Mocks Turnstile siteverify (the only outbound fetch intake makes). Default answer mirrors Cloudflare's
 * dummy secrets: 1x... passes, 2x... fails, 3x... says the token was already spent. Returns the spy so tests
 * can count redemptions.
 */
export function mockSiteverify(answer?: (form: { secret: string; response: string }) => Siteverify) {
  const realFetch = globalThis.fetch
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init)
    if (req.url !== SITEVERIFY_URL) return realFetch(input, init)
    const form = await req.formData()
    const secret = String(form.get('secret'))
    const response = String(form.get('response'))
    const body = answer
      ? answer({ secret, response })
      : secret.startsWith('1x')
        ? { success: true, hostname: 'example.com', action: '' }
        : secret.startsWith('3x')
          ? { success: false, 'error-codes': ['timeout-or-duplicate'] }
          : { success: false, 'error-codes': ['invalid-input-response'] }
    return Response.json({ 'error-codes': [], ...body })
  })
}

export function siteverifyCalls(spy: ReturnType<typeof mockSiteverify>) {
  return spy.mock.calls.filter(([input, init]) => new Request(input, init).url === SITEVERIFY_URL).length
}
