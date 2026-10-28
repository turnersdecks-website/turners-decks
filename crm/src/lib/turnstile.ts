// Turnstile siteverify (PLAN.md > Intake contract): `success`, expected hostname and action.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** The `action` the site's widget is rendered with (`data-action`). */
export const TURNSTILE_ACTION = 'intake'
/** What Cloudflare's dummy site keys put in the widget. Never valid in production mode. */
export const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
// Cloudflare's documented testing secrets: 1x (passes), 2x (fails), 3x (token already spent).
const DUMMY_SECRET = /^[123]x0+AA$/

export type TurnstileCheck = {
  token: string | null
  secret: string
  /** production/staging: strict. development: Cloudflare dummy keys accepted. */
  strict: boolean
  allowedHostnames: string[]
  remoteIp: string | null
}

/**
 * `human` only if Cloudflare confirms the token for one of our hostnames and the intake action.
 * `spent` when Cloudflare says the token was already redeemed (or expired): maybe by a concurrent twin.
 */
export type TurnstileOutcome = { human: boolean; spent: boolean }
const refused: TurnstileOutcome = { human: false, spent: false }

export async function verifyTurnstile(c: TurnstileCheck): Promise<TurnstileOutcome> {
  if (!c.token || c.token.length > 2048 || !c.secret) return refused
  const dummySecret = DUMMY_SECRET.test(c.secret)
  if (c.strict && (dummySecret || c.token === DUMMY_TOKEN)) return refused

  const form = new FormData()
  form.set('secret', c.secret)
  form.set('response', c.token)
  if (c.remoteIp) form.set('remoteip', c.remoteIp)
  let outcome: { success?: unknown; hostname?: unknown; action?: unknown; 'error-codes'?: unknown }
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return refused
    outcome = await res.json()
  } catch {
    return refused
  }
  if (outcome.success !== true) {
    const codes = Array.isArray(outcome['error-codes']) ? outcome['error-codes'] : []
    return { human: false, spent: codes.includes('timeout-or-duplicate') }
  }
  // Dummy secrets answer with a placeholder hostname and no action, so only real keys are checked further.
  const human =
    dummySecret ||
    (typeof outcome.hostname === 'string' &&
      c.allowedHostnames.includes(outcome.hostname) &&
      outcome.action === TURNSTILE_ACTION)
  return { human, spent: false }
}
