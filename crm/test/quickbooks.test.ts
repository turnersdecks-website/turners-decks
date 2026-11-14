import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/db/client'
import { jobTotals } from '#/lib/qbo-vocab'
import { assignTransactions, completeConnect, jobFinancials, makeState, readState, seal, syncQuickBooks, unseal } from '#/lib/qbo.server'

// docs/adr/0006-quickbooks-sync.md: QuickBooks transactions copy into the CRM nightly (read only there), invoices go on
// their Customer's Job by themselves, costs wait for Staff or Claude with a suggested Job.

const qEnv = { ...env, QBO_CLIENT_ID: 'client', QBO_CLIENT_SECRET: 'secret', BETTER_AUTH_URL: 'https://crm.example' }
const db = () => getDb(env.DB)
const T0 = Date.UTC(2026, 10, 1, 9)

type Answer = (url: URL, init?: RequestInit) => unknown
/** A stand-in for Intuit: token endpoint, query and cdc. Records each call. */
function fakeIntuit(data: { query?: Record<string, unknown[]>; cdc?: Record<string, unknown[]>; token?: Answer } = {}) {
  const calls: string[] = []
  let n = 0
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.hostname === 'oauth.platform.intuit.com') {
      const body = new URLSearchParams(String(init?.body))
      calls.push(`token:${body.get('grant_type')}`)
      n++
      return Response.json(data.token?.(url, init) ?? { access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600, x_refresh_token_expires_in: 8_640_000 })
    }
    const path = url.pathname.split('/').at(-1)!
    if (path === 'query') {
      const entity = /FROM (\w+)/.exec(url.searchParams.get('query') ?? '')![1]!
      calls.push(`query:${entity}`)
      return Response.json({ QueryResponse: { [entity]: data.query?.[entity] ?? [] } })
    }
    if (path === 'cdc') {
      calls.push('cdc')
      return Response.json({ CDCResponse: [{ QueryResponse: Object.entries(data.cdc ?? {}).map(([k, v]) => ({ [k]: v })) }] })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

async function job(first: string, last: string, cols: { start?: string; finish?: string } = {}) {
  const customerId = crypto.randomUUID()
  const jobId = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO customers (id, first_name, last_name, client_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(customerId, first, last, 'residential', T0, T0)
    .run()
  await env.DB.prepare('INSERT INTO jobs (id, customer_id, name, status, start_date, finish_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(jobId, customerId, `${last} deck`, 'in_progress', cols.start ?? null, cols.finish ?? null, T0, T0)
    .run()
  return jobId
}

const txn = (id: string) => env.DB.prepare('SELECT * FROM qbo_transactions WHERE id = ?').bind(id).first<Record<string, any>>()

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM qbo_transactions').run()
  await env.DB.prepare('DELETE FROM qbo_connection').run()
})

describe('connecting QuickBooks', () => {
  it('the sign-in state is signed and expires; tokens are stored encrypted', async () => {
    const state = await makeState('s3cret', 'staff-1', T0)
    expect(await readState('s3cret', state, T0 + 60_000)).toBe('staff-1')
    expect(await readState('s3cret', state, T0 + 20 * 60_000)).toBeNull()
    expect(await readState('other', state, T0)).toBeNull()
    expect(await unseal('k', await seal('k', 'hello'))).toBe('hello')

    const intuit = fakeIntuit()
    await completeConnect(db(), qEnv, { code: 'c', realmId: '9130', staffId: null as unknown as string }, { fetch: intuit.fetch, now: () => T0 })
    const conn = await env.DB.prepare('SELECT * FROM qbo_connection').first<Record<string, any>>()
    expect(conn).toMatchObject({ realm_id: '9130' })
    expect(conn!.access_token_enc).not.toContain('access-1')
    expect(await unseal(qEnv.BETTER_AUTH_SECRET, conn!.refresh_token_enc)).toBe('refresh-1')
  })
})

describe('the sync', () => {
  it('first sync reads everything; invoices go on their Customer\'s Job, costs get a suggested Job', async () => {
    const smith = await job('Sam', 'Smith', { start: '2026-10-01', finish: '2026-10-30' })
    const intuit = fakeIntuit({
      query: {
        Purchase: [
          { Id: '1', TxnDate: '2026-10-05', TotalAmt: 1234.56, EntityRef: { name: 'Trex Supply', value: '7' }, PrivateNote: 'boards for Smith', Line: [{ Amount: 1234.56, DetailType: 'AccountBasedExpenseLineDetail', AccountBasedExpenseLineDetail: { AccountRef: { name: 'Job Materials' } } }] },
          { Id: '2', TxnDate: '2026-12-01', TotalAmt: 40, EntityRef: { name: 'Shell' }, PrivateNote: 'gas' },
        ],
        Invoice: [{ Id: '9', TxnDate: '2026-10-02', TotalAmt: 9000, CustomerRef: { name: 'Sam Smith', value: '3' }, DocNumber: '1001' }],
        Payment: [{ Id: '10', TxnDate: '2026-10-03', TotalAmt: 9000, CustomerRef: { name: 'sam smith' } }],
      },
    })
    await completeConnect(db(), qEnv, { code: 'c', realmId: 'R', staffId: null as unknown as string }, { fetch: intuit.fetch, now: () => T0 })

    const res = await syncQuickBooks(db(), qEnv, { fetch: intuit.fetch, now: () => T0 })

    expect(res).toMatchObject({ mode: 'full', saved: 4, matched: 2 })
    expect(intuit.calls.filter((c) => c.startsWith('query:'))).toHaveLength(7)
    expect(await txn('Invoice:9')).toMatchObject({ kind: 'revenue', amount_cents: 900000, job_id: smith, assignment: 'job', assigned_by: 'auto' })
    expect(await txn('Payment:10')).toMatchObject({ kind: 'payment', job_id: smith })
    expect(await txn('Purchase:1')).toMatchObject({ kind: 'cost', amount_cents: 123456, account: 'Job Materials', assignment: null, suggested_job_id: smith })
    expect(await txn('Purchase:2')).toMatchObject({ assignment: null, suggested_job_id: null })
  })

  it('later syncs ask only for changes, keep how Staff sorted them, and mark deletions', async () => {
    const jones = await job('Jo', 'Jones')
    const first = fakeIntuit({ query: { Bill: [{ Id: '5', TxnDate: '2026-10-10', TotalAmt: 500, VendorRef: { name: 'Lumber Co' } }, { Id: '6', TxnDate: '2026-10-11', TotalAmt: 80, VendorRef: { name: 'Lumber Co' } }] } })
    await completeConnect(db(), qEnv, { code: 'c', realmId: 'R', staffId: null as unknown as string }, { fetch: first.fetch, now: () => T0 })
    await syncQuickBooks(db(), qEnv, { fetch: first.fetch, now: () => T0 })
    await assignTransactions(db(), { ids: ['Bill:5'], to: 'job', jobId: jones }, 'staff-1')

    const later = fakeIntuit({ cdc: { Bill: [{ Id: '5', TxnDate: '2026-10-10', TotalAmt: 550, VendorRef: { name: 'Lumber Co' } }, { Id: '6', status: 'Deleted' }] } })
    const res = await syncQuickBooks(db(), qEnv, { fetch: later.fetch, now: () => T0 + 86_400_000 })

    expect(res.mode).toBe('changes')
    expect(later.calls).toEqual(['token:refresh_token', 'cdc'])
    expect(await txn('Bill:5')).toMatchObject({ amount_cents: 55000, job_id: jones, assignment: 'job', assigned_by: 'staff-1' })
    expect(await txn('Bill:6')).toMatchObject({ deleted: 1 })
  })

  it('refreshes an expired access token and keeps the rotated refresh token', async () => {
    const intuit = fakeIntuit()
    await completeConnect(db(), qEnv, { code: 'c', realmId: 'R', staffId: null as unknown as string }, { fetch: intuit.fetch, now: () => T0 })
    await syncQuickBooks(db(), qEnv, { fetch: intuit.fetch, now: () => T0 + 2 * 3600_000 })
    expect(intuit.calls.filter((c) => c.startsWith('token:'))).toEqual(['token:authorization_code', 'token:refresh_token'])
    const conn = await env.DB.prepare('SELECT refresh_token_enc, last_sync_error FROM qbo_connection').first<Record<string, any>>()
    expect(await unseal(qEnv.BETTER_AUTH_SECRET, conn!.refresh_token_enc)).toBe('refresh-2')
    expect(conn!.last_sync_error).toBeNull()
  })

  it('a failed sync is recorded for Settings to show', async () => {
    const intuit = fakeIntuit()
    await completeConnect(db(), qEnv, { code: 'c', realmId: 'R', staffId: null as unknown as string }, { fetch: intuit.fetch, now: () => T0 })
    const broken = (async () => new Response('down', { status: 503 })) as typeof fetch
    await expect(syncQuickBooks(db(), qEnv, { fetch: broken, now: () => T0 })).rejects.toThrow()
    expect((await env.DB.prepare('SELECT last_sync_error FROM qbo_connection').first<Record<string, any>>())!.last_sync_error).toMatch(/503/)
  })
})

describe("a Job's money", () => {
  it('costs net of credits, invoiced net of credit memos, payments apart', async () => {
    expect(
      jobTotals([
        { kind: 'cost', amountCents: 1000 },
        { kind: 'cost_credit', amountCents: 100 },
        { kind: 'revenue', amountCents: 5000 },
        { kind: 'revenue_credit', amountCents: 500 },
        { kind: 'payment', amountCents: 4500 },
        { kind: 'cost', amountCents: 999, deleted: true },
      ]),
    ).toEqual({ costCents: 900, revenueCents: 4500, paidCents: 4500, profitCents: 3600 })
  })

  it('overhead and unsorting work, and a Job shows only its own transactions', async () => {
    const lee = await job('Lu', 'Leeward')
    const intuit = fakeIntuit({ query: { Purchase: [{ Id: '11', TxnDate: '2026-10-01', TotalAmt: 300 }, { Id: '12', TxnDate: '2026-10-01', TotalAmt: 20 }] } })
    await completeConnect(db(), qEnv, { code: 'c', realmId: 'R', staffId: null as unknown as string }, { fetch: intuit.fetch, now: () => T0 })
    await syncQuickBooks(db(), qEnv, { fetch: intuit.fetch, now: () => T0 })
    await assignTransactions(db(), { ids: ['Purchase:11'], to: 'job', jobId: lee }, 'claude:staff-1')
    await assignTransactions(db(), { ids: ['Purchase:12'], to: 'overhead' }, 'staff-1')

    expect((await jobFinancials(db(), lee)).totals.costCents).toBe(30000)
    expect(await txn('Purchase:12')).toMatchObject({ assignment: 'overhead', job_id: null })
    await assignTransactions(db(), { ids: ['Purchase:12'], to: 'unassigned' }, 'staff-1')
    expect(await txn('Purchase:12')).toMatchObject({ assignment: null })
    await expect(assignTransactions(db(), { ids: ['Purchase:11'], to: 'job', jobId: 'nope' }, 'staff-1')).rejects.toMatchObject({ status: 404 })
  })
})
