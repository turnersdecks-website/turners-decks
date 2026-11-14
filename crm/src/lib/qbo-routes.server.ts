import { waitUntil } from 'cloudflare:workers'
import { getDb } from '#/db/client'
import { createAuth } from '#/lib/auth'
import { type QboDeps, type QboEnv, authorizeUrl, completeConnect, makeState, readState, syncQuickBooks } from '#/lib/qbo.server'

// GET /api/qbo/connect and GET /api/qbo/callback (docs/adr/0006-quickbooks-sync.md). An admin session is required on
// both; the signed `state` ties the callback to the admin who started it.

type Env = QboEnv & Parameters<typeof createAuth>[0]

const back = (env: Env, result: string) => Response.redirect(`${env.BETTER_AUTH_URL.replace(/\/+$/, '')}/settings?qbo=${encodeURIComponent(result)}#quickbooks`, 302)

/** 401 with no session (route policy), 403 for Staff who are not admins, else the admin. */
async function adminOf(request: Request, env: Env): Promise<Response | { id: string }> {
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session) return new Response('Unauthorized', { status: 401 })
  if (session.user.role !== 'admin') return new Response('Only an admin can connect QuickBooks.', { status: 403 })
  return session.user
}

export async function handleQboConnect(request: Request, env: Env): Promise<Response> {
  const admin = await adminOf(request, env)
  if (admin instanceof Response) return admin
  if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET) return back(env, 'missing-keys')
  return Response.redirect(authorizeUrl(env, await makeState(env.BETTER_AUTH_SECRET, admin.id)), 302)
}

export async function handleQboCallback(request: Request, env: Env, deps: QboDeps = {}): Promise<Response> {
  const admin = await adminOf(request, env)
  if (admin instanceof Response) return admin
  const q = new URL(request.url).searchParams
  if (q.get('error')) return back(env, 'declined')
  const staffId = await readState(env.BETTER_AUTH_SECRET, q.get('state'))
  const code = q.get('code')
  const realmId = q.get('realmId')
  if (!staffId || staffId !== admin.id || !code || !realmId) return back(env, 'expired')
  const db = getDb(env.DB)
  try {
    await completeConnect(db, env, { code, realmId, staffId }, deps)
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'quickbooks connect failed', error: String(err).slice(0, 300) }))
    return back(env, 'failed')
  }
  // The first (full) sync runs after the redirect; the Settings page shows its progress on reload.
  const first = syncQuickBooks(db, env, deps).catch((err) => console.error(JSON.stringify({ level: 'error', msg: 'quickbooks first sync failed', error: String(err).slice(0, 300) })))
  try {
    waitUntil(first)
  } catch {
    // outside a request (tests)
  }
  return back(env, 'connected')
}
