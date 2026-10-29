import { AuthorizationError, CimdFetchError, OAuthProvider, type ConsentDescription, type OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import handler from '@tanstack/react-start/server-entry'
import { createAuth } from '#/lib/auth'
import { handleMcp } from '#/mcp/server'

// MCP sign-in. The Worker is its own OAuth authorization server (Cloudflare's workers-oauth-provider, one-Worker
// `OAuthProvider` shape): Claude (or another MCP client) registers itself (RFC 7591), sends the Staff member to
// /oauth/authorize, which uses the CRM's own Better Auth session and a consent page, and then calls /mcp with a
// bearer token. The token's props carry only the Staff id; src/mcp/server.ts re-reads the Staff member on every call,
// so a banned or removed Staff member loses MCP access at once. Everything that is not an OAuth route or /mcp goes
// to the CRM app unchanged.

export const MCP_SCOPE = 'crm'
export const MCP_PATH = '/mcp'
export const AUTHORIZE_PATH = '/oauth/authorize'

export type McpProps = { staffId: string }

const providers = new Map<string, OAuthProvider<Env>>()

/** The provider for this deployment: its resource is `${BETTER_AUTH_URL}/mcp` (the CRM's own address). */
export function oauthProvider(env: Env): OAuthProvider<Env> {
  const base = env.BETTER_AUTH_URL.replace(/\/+$/, '')
  let provider = providers.get(base)
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: MCP_PATH,
      apiHandler: { fetch: (request, env, ctx) => handleMcp(request, env, (ctx as unknown as { props: McpProps }).props) },
      defaultHandler: {
        fetch: (request, env) => (new URL(request.url).pathname === AUTHORIZE_PATH ? authorize(request, env) : handler.fetch(request)),
      },
      authorizeEndpoint: AUTHORIZE_PATH,
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: [MCP_SCOPE],
      requiredScopes: [MCP_SCOPE],
      resourceMetadata: { resource: `${base}${MCP_PATH}`, authorization_servers: [base] },
      // ponytail: one hour access tokens, refreshed by the client; a removed Staff member is refused at once anyway
      // (server.ts re-reads them), so a longer TTL would only matter for revoking a stolen token.
      accessTokenTTL: 3600,
    })
    providers.set(base, provider)
  }
  return provider
}

type EnvWithHelpers = Env & { OAUTH_PROVIDER: OAuthHelpers }

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

function page(title: string, body: string, headers = new Headers(), status = 200) {
  headers.set('content-type', 'text/html; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} - Turner’s Decks CRM</title>
<style>
:root{--bg:oklch(.978 .007 84.58);--fg:oklch(.2724 .0249 251.15);--muted:oklch(.4477 .0262 250.5);--border:oklch(.86 .012 84.58);--primary:oklch(.5112 .1165 49.66);--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:oklch(.2 .02 251.15);--fg:oklch(.9563 .0143 84.58);--muted:oklch(.78 .02 250.5);--border:oklch(.35 .02 251.15);--primary:oklch(.7298 .1172 55.27);--card:oklch(.24 .02 251.15)}}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.5 "Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px}
h1{font:700 22px/1.3 Domine,Georgia,serif;margin:0 0 12px}p{margin:0 0 12px}.muted{color:var(--muted);font-size:14px}
ul{margin:0 0 16px;padding-left:20px}li{margin:4px 0}.warn{border-left:3px solid var(--primary);padding-left:10px}
.actions{display:flex;gap:10px;margin-top:20px}button{flex:1;min-height:44px;border-radius:8px;font:600 15px/1 inherit;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--fg)}
button.primary{background:var(--primary);border-color:var(--primary);color:#fff}
</style></head><body><main>${body}</main></body></html>`,
    { status, headers },
  )
}

function consentPage(details: ConsentDescription, handle: string, staff: { name: string; email: string; role: string }, headers: Headers) {
  const client = escape(details.clientName)
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : 'This app registered itself, so its name is not verified.'
  const loopback = details.redirectIsLoopback
    ? '<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>'
    : ''
  return page(
    `Connect ${details.clientName}`,
    `<h1>Let ${client} use the CRM as you?</h1>
<p>Signed in as <strong>${escape(staff.name)}</strong> (${escape(staff.email)}).</p>
<p>${client} will be able to do what you can do in the CRM${staff.role === 'admin' ? ' as an admin' : ''}:</p>
<ul><li>Read Leads, Customers, Jobs, Follow-ups and estimates</li><li>Add and edit Leads, notes, Customers and Jobs, and move Leads between stages</li>${staff.role === 'admin' ? '<li>Edit company settings and the estimator draft (never publish it)</li>' : ''}</ul>
<p class="muted">It can never delete anything. ${origin} Access goes to <strong>${escape(details.redirectHost)}</strong>.</p>
${loopback}
<form method="post">
<input type="hidden" name="handle" value="${escape(handle)}">
<div class="actions"><button name="decision" value="deny">Cancel</button><button class="primary" name="decision" value="approve">Allow</button></div>
</form>`,
    headers,
  )
}

/** The signed-in, active Staff member for this request, or null. */
async function staffSession(request: Request, env: Env) {
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session || session.user.banned) return null
  return { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.role ?? 'staff' }
}

/** GET shows the consent page (after the CRM sign-in); POST is the Allow / Cancel form. */
async function authorize(request: Request, env: Env): Promise<Response> {
  const oauth = (env as EnvWithHelpers).OAUTH_PROVIDER
  try {
    const staff = await staffSession(request, env)
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request)
      if (!staff) {
        const url = new URL(request.url)
        const next = `${url.pathname}${url.search}`
        return Response.redirect(new URL(`/sign-in?next=${encodeURIComponent(next)}`, url).toString(), 302)
      }
      const details = await oauth.describeConsent(authRequest) // first: a failed lookup leaves nothing in KV
      const consent = await oauth.beginConsent(authRequest)
      return consentPage(details, consent.handle, staff, consent.headers)
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    if (!staff) return page('Signed out', '<h1>You are signed out</h1><p>Sign in to the CRM, then start connecting again from Claude.</p>', undefined, 401)
    const form = await request.formData()
    const handle = String(form.get('handle') ?? '')
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(request, handle)
      return new Response(null, { status: 302, headers: denied.headers })
    }
    const approved = await oauth.approveConsent(request, handle, { scope: [MCP_SCOPE] })
    const props: McpProps = { staffId: staff.id }
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request, // from storage, not from the form
      userId: staff.id,
      metadata: { staffName: staff.name },
      scope: [MCP_SCOPE],
      props,
    })
    approved.headers.set('Location', redirectTo)
    return new Response(null, { status: 302, headers: approved.headers })
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302)
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError ? error.description : 'This app could not be verified.'
      return page('Could not connect', `<h1>Could not connect</h1><p>${escape(message ?? 'The request was not valid.')}</p><p class="muted">Start connecting again from Claude.</p>`, undefined, 400)
    }
    throw error
  }
}
