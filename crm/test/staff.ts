import { SELF, env } from 'cloudflare:test'
import { fromCrossJSON, toJSONAsync } from 'seroval'
import { createAuth } from '#/lib/auth'

export const BASE = 'http://localhost'
const PASSWORD = 'correct horse battery'

/** Creates a Staff member (role admin or staff) server-side and returns a signed-in session cookie. */
export async function signedInStaff(role: 'admin' | 'staff' = 'staff', opts: { email?: string; name?: string } = {}) {
  const email = opts.email ?? `${role}-${crypto.randomUUID()}@example.com`
  await createAuth(env).api.createUser({ body: { email, password: PASSWORD, name: opts.name ?? 'Test Staff', role } })
  const res = await SELF.fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`)
  return { email, cookie: res.headers.get('set-cookie')!.split(';')[0] }
}

/** Calls a server function over HTTP the way the browser RPC client does (same-origin). */
// Server functions are served under `/_serverFn/<id>` (TSS_SERVER_FN_BASE, see vitest.config.ts).
// `data` is serialized the way the client does it (seroval JSON of `{ data }`); with no data the client sends no body.
export async function callServerFn(fn: { serverFnMeta: { id: string }; method?: string }, cookie?: string, data?: unknown) {
  const method = (fn.method ?? 'GET').toUpperCase()
  const payload = data !== undefined ? JSON.stringify(await toJSONAsync({ data })) : undefined
  // GET carries the payload in `?payload=` (as the client does); POST in the body.
  const query = method === 'GET' && payload ? `?payload=${encodeURIComponent(payload)}` : ''
  return SELF.fetch(`${BASE}/_serverFn/${fn.serverFnMeta.id}${query}`, {
    method,
    headers: {
      'x-tsr-serverfn': 'true',
      'sec-fetch-site': 'same-origin',
      ...(payload && method !== 'GET' ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: method !== 'GET' ? payload : undefined,
    redirect: 'manual',
  })
}

/** The value a server function returned (its reply is seroval cross-JSON of `{ result }`). */
export async function serverFnResult<T = unknown>(res: Response): Promise<T> {
  if (res.status !== 200) throw new Error(`server function failed: ${res.status} ${await res.text()}`)
  return (fromCrossJSON(await res.json(), { refs: new Map() }) as { result: T }).result
}
