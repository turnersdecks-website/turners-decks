import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { insertLead, leadRow, staffIdOf } from './lead-helpers'
import { randomPhone } from './intake-helpers'
import { BASE, signedInStaff } from './staff'

// Connecting Claude (src/mcp/): OAuth sign-in with the CRM's own Staff login and a consent page, then the CRM's
// tools over MCP, as the Staff member who connected.

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

async function registerClient() {
  const res = await SELF.fetch(`${BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  })
  expect(res.status).toBe(201)
  return (await res.json<{ client_id: string }>()).client_id
}

async function authorizeUrl(clientId: string) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'crm',
    state: 'state-123',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${BASE}/mcp`,
  })
  return { url: `${BASE}/oauth/authorize?${q}`, verifier }
}

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0])

/** Runs the whole connection as a Staff member and returns an access token. */
async function connect(cookie: string) {
  const clientId = await registerClient()
  const { url, verifier } = await authorizeUrl(clientId)
  const consent = await SELF.fetch(url, { headers: { cookie }, redirect: 'manual' })
  expect(consent.status).toBe(200)
  const html = await consent.text()
  const handle = html.match(/name="handle" value="([^"]+)"/)![1]
  const approved = await SELF.fetch(url, {
    method: 'POST',
    headers: { cookie: [cookie, ...cookiesOf(consent)].join('; '), 'content-type': 'application/x-www-form-urlencoded', origin: BASE },
    body: new URLSearchParams({ handle, decision: 'approve' }),
    redirect: 'manual',
  })
  expect(approved.status).toBe(302)
  const back = new URL(approved.headers.get('location')!)
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT)
  expect(back.searchParams.get('state')).toBe('state-123')
  const token = await SELF.fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code')!,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${BASE}/mcp`,
    }),
  })
  expect(token.status).toBe(200)
  return (await token.json<{ access_token: string }>()).access_token
}

let rpcId = 0
async function mcp(token: string, method: string, params: Record<string, unknown> = {}) {
  return SELF.fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
}

type ToolReply = { result?: { content: { text: string }[]; isError?: boolean }; error?: unknown }
async function tool<T = unknown>(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await mcp(token, 'tools/call', { name, arguments: args })
  expect(res.status).toBe(200)
  const reply = await res.json<ToolReply>()
  const text = reply.result?.content[0]?.text ?? ''
  return { isError: reply.result?.isError === true, text, value: (reply.result?.isError ? null : JSON.parse(text)) as T }
}

describe('connecting Claude', () => {
  it('the MCP endpoint refuses a caller with no token and says where to sign in', async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, { method: 'POST', body: '{}' })

    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata')
    const meta = await SELF.fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)
    expect(meta.status).toBe(200)
  })

  it('someone not signed in to the CRM is sent to sign in first, and comes back to the consent page', async () => {
    const { url } = await authorizeUrl(await registerClient())

    const res = await SELF.fetch(url, { redirect: 'manual' })

    expect(res.status).toBe(302)
    const to = new URL(res.headers.get('location')!)
    expect(to.pathname).toBe('/sign-in')
    expect(to.searchParams.get('next')).toMatch(/^\/oauth\/authorize\?/)
  })

  it('the consent page names the app and the Staff member, and Cancel sends the app away with no access', async () => {
    const { cookie } = await signedInStaff('staff', { name: 'Pat Turner' })
    const { url } = await authorizeUrl(await registerClient())
    const consent = await SELF.fetch(url, { headers: { cookie }, redirect: 'manual' })
    const html = await consent.text()

    expect(html).toContain('Let Claude use the CRM as you?')
    expect(html).toContain('Pat Turner')
    const handle = html.match(/name="handle" value="([^"]+)"/)![1]
    const denied = await SELF.fetch(url, {
      method: 'POST',
      headers: { cookie: [cookie, ...cookiesOf(consent)].join('; '), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ handle, decision: 'deny' }),
      redirect: 'manual',
    })
    expect(new URL(denied.headers.get('location')!).searchParams.get('error')).toBe('access_denied')
  })

  it('once allowed, Claude lists the CRM tools, none of which delete anything', async () => {
    const { cookie } = await signedInStaff('staff')
    const token = await connect(cookie)

    const res = await mcp(token, 'tools/list')

    expect(res.status).toBe(200)
    const names = (await res.json<{ result: { tools: { name: string }[] } }>()).result.tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['search_leads', 'get_lead', 'move_lead_stage', 'list_customers', 'import_customers', 'update_job', 'update_estimator_draft']))
    expect(names.filter((n) => /delete|remove|publish/.test(n))).toEqual([])
  })

  it('a banned Staff member’s connection stops working at once', async () => {
    const { cookie, email } = await signedInStaff('staff')
    const token = await connect(cookie)
    await env.DB.prepare('UPDATE user SET banned = 1 WHERE email = ?').bind(email).run()

    expect((await mcp(token, 'tools/list')).status).toBe(403)
  })
})

describe('the CRM tools', () => {
  it('moving a Lead to won through Claude makes the Customer and Job, credited to the Staff member', async () => {
    const { cookie, email } = await signedInStaff('staff')
    const token = await connect(cookie)
    const leadId = await insertLead({ firstName: 'Mona', phoneE164: `+1${randomPhone()}`, stage: 'quoted' })

    const moved = await tool<{ customerId: string }>(token, 'move_lead_stage', { leadId, stage: 'won' })

    expect(moved.value.customerId).toBeTruthy()
    expect((await leadRow(leadId))?.customer_id).toBe(moved.value.customerId)
    const history = await env.DB.prepare("SELECT changed_by FROM lead_stage_changes WHERE lead_id = ? AND to_stage = 'won'").bind(leadId).first('changed_by')
    expect(history).toBe(await staffIdOf(email))
    const customer = await tool<{ jobs: { leadId: string }[] }>(token, 'get_customer', { customerId: moved.value.customerId })
    expect(customer.value.jobs.map((j) => j.leadId)).toEqual([leadId])
  })

  it('update_lead changes only the fields it names', async () => {
    const { cookie } = await signedInStaff('staff')
    const token = await connect(cookie)
    const leadId = await insertLead({ firstName: 'Ned', lastName: 'Neighbor' })

    const res = await tool(token, 'update_lead', { leadId, zip: '19518' })

    expect(res.isError).toBe(false)
    expect(await leadRow(leadId)).toMatchObject({ first_name: 'Ned', last_name: 'Neighbor', zip: '19518', street: '12 Main St' })
  })

  it('a note with a Follow-up shows in the open Follow-ups and can be marked done', async () => {
    const { cookie } = await signedInStaff('staff')
    const token = await connect(cookie)
    const leadId = await insertLead()

    const { value: note } = await tool<{ id: string }>(token, 'add_lead_activity', { leadId, kind: 'note', body: 'Call about railings', followUpAt: '2027-03-01T10:00:00-05:00' })
    const open = await tool<{ activityId: string }[]>(token, 'list_follow_ups', { limit: 500 })
    expect(open.value.map((f) => f.activityId)).toContain(note.id)
    await tool(token, 'set_follow_up_done', { activityId: note.id, done: true })

    const after = await tool<{ activityId: string }[]>(token, 'list_follow_ups', { limit: 500 })
    expect(after.value.map((f) => f.activityId)).not.toContain(note.id)
  })

  it('import_customers adds past Customers with their Jobs and skips one that is already there', async () => {
    const { cookie } = await signedInStaff('staff')
    const token = await connect(cookie)
    const phone = randomPhone()
    await tool(token, 'create_customer', { firstName: 'Already', phone })

    const out = await tool<{ created: number; skipped: number; results: { status: string; customerId?: string; jobIds?: string[] }[] }>(token, 'import_customers', {
      customers: [
        { firstName: 'Olive', lastName: 'Older', city: 'Gilbertsville', customerSince: '2022-05-01', jobs: [{ name: 'Composite deck', status: 'done', finishDate: '2022-06-10', quotedPrice: 31500 }] },
        { firstName: 'Dup', phone },
      ],
    })

    expect(out.value).toMatchObject({ created: 1, skipped: 1 })
    const job = await tool<{ job: { quotedPrice: number; status: string } }>(token, 'get_job', { jobId: out.value.results[0].jobIds![0] })
    expect(job.value.job).toMatchObject({ quotedPrice: 31500, status: 'done' })
  })

  it('an import row with a bad Job is reported and nothing is written for it', async () => {
    const { cookie } = await signedInStaff('staff')
    const token = await connect(cookie)
    const phone = randomPhone()

    const out = await tool<{ errors: number }>(token, 'import_customers', { customers: [{ firstName: 'Bad', phone, jobs: [{ name: 'Deck', startDate: '2022-13-01' }] }] })

    expect(out.value.errors).toBe(1)
    expect(await env.DB.prepare('SELECT count(*) AS n FROM customers WHERE phone_e164 = ?').bind(`+1${phone}`).first('n')).toBe(0)
  })

  it('a bad value comes back as an error Claude can read, not a crash', async () => {
    const { cookie } = await signedInStaff('staff')
    const token = await connect(cookie)
    const { value: c } = await tool<{ id: string }>(token, 'create_customer', { firstName: 'Errol' })

    const res = await tool(token, 'create_job', { customerId: c.id, name: 'Deck', startDate: '2027-02-30' })

    expect(res.isError).toBe(true)
    expect(res.text).toContain('not a real date')
  })

  it('admin-only tools refuse a staff login', async () => {
    const { cookie } = await signedInStaff('staff')
    const token = await connect(cookie)

    const res = await tool(token, 'update_company_settings', { name: 'Someone Else' })

    expect(res.isError).toBe(true)
    expect(res.text).toContain('Only an admin')
  })

  it('an admin can change one company setting and the rest stay', async () => {
    const { cookie } = await signedInStaff('admin')
    const token = await connect(cookie)
    const before = (await tool<{ timezone: string; name: string }>(token, 'get_company_settings')).value

    const res = await tool<{ phone: string; timezone: string; name: string }>(token, 'update_company_settings', { phone: '(484) 824-0373' })

    expect(res.value).toMatchObject({ phone: '(484) 824-0373', timezone: before.timezone, name: before.name })
  })

  it('an admin can save the estimator draft but it does not go live', async () => {
    const { cookie } = await signedInStaff('admin')
    const token = await connect(cookie)
    const { value } = await tool<{ live: { version: number }; draft: { revision: number; document: { prices: { permitAllowance: number } } } }>(token, 'get_estimator_settings')
    const document = { ...value.draft.document, prices: { ...value.draft.document.prices, permitAllowance: 1250 } }

    const saved = await tool<{ revision: number }>(token, 'update_estimator_draft', { document, revision: value.draft.revision })

    expect(saved.isError).toBe(false)
    const after = await tool<{ live: { version: number }; draftDiffersFromLive: boolean }>(token, 'get_estimator_settings')
    expect(after.value.live.version).toBe(value.live.version)
    expect(after.value.draftDiffersFromLive).toBe(true)
  })
})
