// Plan 010 F1: Staff sign-in and password-reset abuse limit (Workers Rate Limiting binding, wrangler.jsonc).
// ponytail: the binding counts per Cloudflare location and is eventually consistent, so a distributed attacker
// gets about 5 tries a minute per email per location, and nothing locks an account. Upgrade path if that ever
// matters: a D1 per-email failure counter checked here.

const LIMITED = ['/sign-in/email', '/request-password-reset']

/** A refusal for a limited auth request, or null to let Better Auth handle it. Fails open if the binding errors. */
export async function limitAuthRequest(env: { AUTH_RATE_LIMITER: RateLimit }, request: Request): Promise<Response | null> {
  if (request.method !== 'POST' || !LIMITED.some((p) => new URL(request.url).pathname.endsWith(p))) return null
  // Better Auth also accepts form-encoded bodies; refusing them keeps the email key from being skipped.
  // The CRM's own auth client always sends JSON.
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return Response.json({ code: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 })
  }
  const body = await request
    .clone()
    .json<{ email?: unknown }>()
    .catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null
  const keys = [`auth:ip:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`, ...(email ? [`auth:email:${email}`] : [])]
  for (const key of keys) {
    const { success } = await env.AUTH_RATE_LIMITER.limit({ key }).catch(() => ({ success: true }))
    if (!success) return Response.json({ code: 'RATE_LIMITED' }, { status: 429, headers: { 'retry-after': '60' } })
  }
  return null
}
