import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { customers, jobs, qboConnection, qboTransactions } from '#/db/schema'
import { badRequest } from '#/lib/input'
import { QBO_ENTITIES, type QboEntity, type QboKind, jobTotals } from '#/lib/qbo-vocab'

// QuickBooks Online sync (docs/adr/0006-quickbooks-sync.md). One admin connects once (OAuth 2.0, /api/qbo/connect).
// A nightly cron (and "Sync now") pulls transactions: the first run reads everything since BACKFILL_FROM with queries,
// later runs ask Change Data Capture for what changed since the last sync (CDC covers 30 days; an older gap re-runs the
// full pull). Reads only: QuickBooks is never written to. Then customer-name matching puts invoices, sales receipts,
// credit memos and payments on Jobs; costs get a suggested Job and wait for Staff (or Claude) to confirm.

type Db = ReturnType<typeof getDb>
export type QboEnv = {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  QBO_CLIENT_ID?: string
  QBO_CLIENT_SECRET?: string
  /** 'sandbox' for an Intuit sandbox company; anything else = production. */
  QBO_ENVIRONMENT?: string
}
export type QboDeps = { fetch?: typeof globalThis.fetch; now?: () => number }

export const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
export const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting'
const MINOR_VERSION = '75'
/** The first sync reads transactions dated from here on. */
export const BACKFILL_FROM = '2025-01-01'
const CDC_MAX_DAYS = 29
const PAGE = 1000
const TIMEOUT_MS = 20_000

const apiBase = (env: QboEnv) => (env.QBO_ENVIRONMENT === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com')
export const redirectUri = (env: Pick<QboEnv, 'BETTER_AUTH_URL'>) => `${env.BETTER_AUTH_URL.replace(/\/+$/, '')}/api/qbo/callback`

// ---------------------------------------------------------------------------
// Secrets at rest: AES-GCM with a key derived from BETTER_AUTH_SECRET.

async function tokenKey(secret: string) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`qbo-tokens:${secret}`))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export async function seal(secret: string, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(secret), new TextEncoder().encode(plain)))
  return `${b64(iv)}.${b64(ct)}`
}
export async function unseal(secret: string, sealed: string) {
  const [iv, ct] = sealed.split('.')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv!) }, await tokenKey(secret), unb64(ct!))
  return new TextDecoder().decode(pt)
}

// ---------------------------------------------------------------------------
// OAuth: a signed `state` (Staff id + expiry, HMAC) instead of a table.

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`qbo-state:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!)
}
export async function makeState(secret: string, staffId: string, now = Date.now()) {
  const body = `${staffId}.${now + 15 * 60_000}`
  return `${body}.${await hmac(secret, body)}`
}
export async function readState(secret: string, state: string | null, now = Date.now()): Promise<string | null> {
  const parts = (state ?? '').split('.')
  if (parts.length !== 3) return null
  const [staffId, exp, sig] = parts as [string, string, string]
  if (Number(exp) < now || sig !== (await hmac(secret, `${staffId}.${exp}`))) return null
  return staffId
}

export function authorizeUrl(env: QboEnv, state: string) {
  if (!env.QBO_CLIENT_ID) throw badRequest('Add QBO_CLIENT_ID and QBO_CLIENT_SECRET to the CRM first.')
  const q = new URLSearchParams({ client_id: env.QBO_CLIENT_ID, response_type: 'code', scope: QBO_SCOPE, redirect_uri: redirectUri(env), state })
  return `${AUTHORIZE_URL}?${q}`
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in: number }

async function tokenCall(env: QboEnv, body: Record<string, string>, deps: QboDeps): Promise<TokenResponse> {
  if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET) throw badRequest('QBO_CLIENT_ID and QBO_CLIENT_SECRET are not set.')
  const res = await (deps.fetch ?? fetch)(TOKEN_URL, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const json = await res.json<Partial<TokenResponse> & { error?: string }>().catch(() => ({}) as Partial<TokenResponse> & { error?: string })
  if (!res.ok || !json.access_token || !json.refresh_token) throw new Error(`QuickBooks sign-in failed (${res.status}${json.error ? `: ${json.error}` : ''})`)
  return json as TokenResponse
}

async function storeTokens(env: QboEnv, t: TokenResponse, now: number, extra: Partial<typeof qboConnection.$inferInsert> = {}) {
  const values = {
    accessTokenEnc: await seal(env.BETTER_AUTH_SECRET, t.access_token),
    refreshTokenEnc: await seal(env.BETTER_AUTH_SECRET, t.refresh_token),
    accessExpiresAt: new Date(now + t.expires_in * 1000),
    refreshExpiresAt: new Date(now + t.x_refresh_token_expires_in * 1000),
    ...extra,
  }
  return values
}

/** The OAuth callback: swap the code for tokens and save the company. Reconnecting a different company starts over. */
export async function completeConnect(db: Db, env: QboEnv, input: { code: string; realmId: string; staffId: string }, deps: QboDeps = {}) {
  const now = deps.now?.() ?? Date.now()
  const t = await tokenCall(env, { grant_type: 'authorization_code', code: input.code, redirect_uri: redirectUri(env) }, deps)
  const before = await db.select({ realmId: qboConnection.realmId }).from(qboConnection).where(eq(qboConnection.id, 1)).get()
  const values = await storeTokens(env, t, now, {
    realmId: input.realmId,
    connectedAt: new Date(now),
    connectedBy: input.staffId,
    lastSyncError: null,
    ...(before && before.realmId !== input.realmId ? { backfilledAt: null, lastSyncAt: null } : {}),
  })
  await db
    .insert(qboConnection)
    .values({ id: 1, realmId: input.realmId, connectedAt: new Date(now), ...values } as typeof qboConnection.$inferInsert)
    .onConflictDoUpdate({ target: qboConnection.id, set: values })
  // A different company's transactions do not belong to these Jobs.
  if (before && before.realmId !== input.realmId) await db.delete(qboTransactions)
}

/** A valid access token, refreshing (and saving the rotated refresh token) when it is within 5 minutes of expiry. */
async function accessToken(db: Db, env: QboEnv, deps: QboDeps) {
  const conn = await db.select().from(qboConnection).where(eq(qboConnection.id, 1)).get()
  if (!conn) throw badRequest('QuickBooks is not connected.')
  const now = deps.now?.() ?? Date.now()
  if (conn.accessExpiresAt.getTime() - now > 5 * 60_000) return { conn, token: await unseal(env.BETTER_AUTH_SECRET, conn.accessTokenEnc) }
  const t = await tokenCall(env, { grant_type: 'refresh_token', refresh_token: await unseal(env.BETTER_AUTH_SECRET, conn.refreshTokenEnc) }, deps)
  await db.update(qboConnection).set(await storeTokens(env, t, now)).where(eq(qboConnection.id, 1))
  return { conn, token: t.access_token }
}

async function qboGet<T>(env: QboEnv, realmId: string, token: string, path: string, params: Record<string, string>, deps: QboDeps): Promise<T> {
  const q = new URLSearchParams({ ...params, minorversion: MINOR_VERSION })
  const res = await (deps.fetch ?? fetch)(`${apiBase(env)}/v3/company/${encodeURIComponent(realmId)}/${path}?${q}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`QuickBooks answered ${res.status} for ${path}: ${(await res.text()).slice(0, 300)}`)
  return res.json<T>()
}

// ---------------------------------------------------------------------------
// Turning QuickBooks records into rows.

type Ref = { value?: string; name?: string }
type QboLine = { Amount?: number; Description?: string; DetailType?: string; AccountBasedExpenseLineDetail?: { AccountRef?: Ref }; ItemBasedExpenseLineDetail?: { ItemRef?: Ref }; SalesItemLineDetail?: { ItemRef?: Ref } }
export type QboRecord = {
  Id: string
  status?: string
  TxnDate?: string
  TotalAmt?: number
  DocNumber?: string
  PrivateNote?: string
  Credit?: boolean
  EntityRef?: Ref
  VendorRef?: Ref
  CustomerRef?: Ref
  AccountRef?: Ref
  APAccountRef?: Ref
  DepositToAccountRef?: Ref
  Line?: QboLine[]
  MetaData?: { LastUpdatedTime?: string }
}

const centsOf = (n: number | undefined) => Math.round((n ?? 0) * 100)

function kindOf(entity: QboEntity, r: QboRecord): QboKind {
  switch (entity) {
    case 'Purchase':
      return r.Credit ? 'cost_credit' : 'cost'
    case 'Bill':
      return 'cost'
    case 'VendorCredit':
      return 'cost_credit'
    case 'Invoice':
    case 'SalesReceipt':
      return 'revenue'
    case 'CreditMemo':
      return 'revenue_credit'
    case 'Payment':
      return 'payment'
  }
}

export function rowOf(entity: QboEntity, r: QboRecord, now: number): typeof qboTransactions.$inferInsert {
  const party = r.EntityRef ?? r.VendorRef ?? r.CustomerRef
  const lines = (r.Line ?? [])
    .filter((l) => l.DetailType !== 'SubTotalLineDetail' && typeof l.Amount === 'number')
    .map((l) => ({
      account: l.AccountBasedExpenseLineDetail?.AccountRef?.name ?? l.ItemBasedExpenseLineDetail?.ItemRef?.name ?? l.SalesItemLineDetail?.ItemRef?.name ?? null,
      description: l.Description?.slice(0, 500) ?? null,
      amountCents: centsOf(l.Amount),
    }))
  return {
    id: `${entity}:${r.Id}`,
    entity,
    qboId: r.Id,
    kind: kindOf(entity, r),
    txnDate: (r.TxnDate ?? '').slice(0, 10) || '1970-01-01',
    amountCents: centsOf(r.TotalAmt),
    partyName: party?.name?.slice(0, 200) ?? null,
    partyQboId: party?.value ?? null,
    account: lines[0]?.account ?? r.AccountRef?.name ?? null,
    memo: r.PrivateNote?.slice(0, 2000) ?? null,
    docNumber: r.DocNumber?.slice(0, 50) ?? null,
    linesJson: lines.length ? JSON.stringify(lines) : null,
    deleted: r.status === 'Deleted',
    qboUpdatedAt: r.MetaData?.LastUpdatedTime ? new Date(r.MetaData.LastUpdatedTime) : null,
    syncedAt: new Date(now),
  }
}

/** Upserts rows, never touching how Staff sorted them. A deleted record keeps only its new `deleted` flag. */
async function saveRows(db: Db, rows: (typeof qboTransactions.$inferInsert)[]) {
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50)
    await db.batch(
      chunk.map((r) =>
        r.deleted
          ? db.update(qboTransactions).set({ deleted: true, syncedAt: r.syncedAt }).where(eq(qboTransactions.id, r.id))
          : db
              .insert(qboTransactions)
              .values(r)
              .onConflictDoUpdate({
                target: qboTransactions.id,
                set: {
                  kind: r.kind,
                  txnDate: r.txnDate,
                  amountCents: r.amountCents,
                  partyName: r.partyName,
                  partyQboId: r.partyQboId,
                  account: r.account,
                  memo: r.memo,
                  docNumber: r.docNumber,
                  linesJson: r.linesJson,
                  deleted: false,
                  qboUpdatedAt: r.qboUpdatedAt,
                  syncedAt: r.syncedAt,
                },
              }),
      ) as unknown as [never, ...never[]],
    )
  }
}

// ---------------------------------------------------------------------------
// The sync.

export type SyncResult = { mode: 'full' | 'changes'; saved: number; matched: number }

export async function syncQuickBooks(db: Db, env: QboEnv, deps: QboDeps = {}): Promise<SyncResult> {
  const startedAt = deps.now?.() ?? Date.now()
  try {
    const { conn, token } = await accessToken(db, env, deps)
    const since = conn.lastSyncAt?.getTime()
    const full = !conn.backfilledAt || !since || startedAt - since > CDC_MAX_DAYS * 86_400_000
    const rows: (typeof qboTransactions.$inferInsert)[] = []
    if (full) {
      for (const entity of QBO_ENTITIES) {
        for (let start = 1; ; start += PAGE) {
          const res = await qboGet<{ QueryResponse?: Record<string, QboRecord[] | undefined> }>(
            env,
            conn.realmId,
            token,
            'query',
            { query: `SELECT * FROM ${entity} WHERE TxnDate >= '${BACKFILL_FROM}' STARTPOSITION ${start} MAXRESULTS ${PAGE}` },
            deps,
          )
          const page = res.QueryResponse?.[entity] ?? []
          rows.push(...page.map((r) => rowOf(entity, r, startedAt)))
          if (page.length < PAGE) break
        }
      }
    } else {
      // An hour of overlap: a record saved while the last sync ran is read again, which is harmless.
      const changedSince = new Date(since! - 60 * 60_000).toISOString()
      const res = await qboGet<{ CDCResponse?: { QueryResponse?: Record<string, QboRecord[] | undefined>[] }[] }>(
        env,
        conn.realmId,
        token,
        'cdc',
        { entities: QBO_ENTITIES.join(','), changedSince },
        deps,
      )
      for (const qr of res.CDCResponse?.[0]?.QueryResponse ?? []) {
        for (const entity of QBO_ENTITIES) for (const r of qr[entity] ?? []) rows.push(rowOf(entity, r, startedAt))
      }
    }
    await saveRows(db, rows)
    const matched = await autoMatch(db)
    await db
      .update(qboConnection)
      .set({ lastSyncAt: new Date(startedAt), lastSyncError: null, ...(full ? { backfilledAt: new Date(startedAt) } : {}) })
      .where(eq(qboConnection.id, 1))
    return { mode: full ? 'full' : 'changes', saved: rows.length, matched }
  } catch (err) {
    const message = err instanceof Response ? await err.clone().text() : String(err)
    await db.update(qboConnection).set({ lastSyncError: message.slice(0, 500) }).where(eq(qboConnection.id, 1))
    throw err
  }
}

// ---------------------------------------------------------------------------
// Matching. Customer-side records (invoice, sales receipt, credit memo, payment) name the customer, so they go on the
// Job automatically when the name matches one Customer: their Job open on that date, else their most recent Job.
// Costs only get a suggestion: a Job whose customer's last name is in the memo or a line description, else the one
// Job being built on that date.

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

type JobLite = { id: string; customerId: string; first: string | null; last: string | null; start: string | null; finish: string | null; status: string; createdAt: Date }

function jobForDate(js: JobLite[], date: string): JobLite | undefined {
  const within = js.filter((j) => (!j.start || j.start <= date) && (!j.finish || j.finish >= date))
  const pick = within.length ? within : js
  return [...pick].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
}

export async function autoMatch(db: Db): Promise<number> {
  const open = await db
    .select()
    .from(qboTransactions)
    .where(and(isNull(qboTransactions.assignment), eq(qboTransactions.deleted, false)))
  if (!open.length) return 0
  const jobRows: JobLite[] = await db
    .select({
      id: jobs.id,
      customerId: jobs.customerId,
      first: customers.firstName,
      last: customers.lastName,
      start: jobs.startDate,
      finish: jobs.finishDate,
      status: jobs.status,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(ne(jobs.status, 'cancelled'))
  const byName = new Map<string, JobLite[]>()
  for (const j of jobRows) {
    const key = norm([j.first, j.last].filter(Boolean).join(' '))
    if (key) byName.set(key, [...(byName.get(key) ?? []), j])
  }
  const customerIds = (js: JobLite[]) => new Set(js.map((j) => j.customerId))
  let matched = 0
  const writes = []
  for (const t of open) {
    if (t.kind === 'revenue' || t.kind === 'revenue_credit' || t.kind === 'payment') {
      const js = byName.get(norm(t.partyName))
      if (js && customerIds(js).size === 1) {
        const job = jobForDate(js, t.txnDate)!
        writes.push(db.update(qboTransactions).set({ jobId: job.id, assignment: 'job', assignedBy: 'auto', assignedAt: new Date() }).where(and(eq(qboTransactions.id, t.id), isNull(qboTransactions.assignment))))
        matched++
      }
      continue
    }
    const text = ` ${norm(t.memo)} ${norm(t.linesJson)} `
    const byMemo = jobRows.filter((j) => j.last && j.last.length >= 4 && text.includes(` ${norm(j.last)} `))
    const building = jobRows.filter((j) => j.start && j.start <= t.txnDate && (!j.finish || j.finish >= t.txnDate) && j.status !== 'done')
    const suggestion = byMemo.length === 1 ? byMemo[0] : !byMemo.length && building.length === 1 ? building[0] : undefined
    if (suggestion && suggestion.id !== t.suggestedJobId) writes.push(db.update(qboTransactions).set({ suggestedJobId: suggestion.id }).where(eq(qboTransactions.id, t.id)))
  }
  for (let i = 0; i < writes.length; i += 50) await db.batch(writes.slice(i, i + 50) as unknown as [never, ...never[]])
  return matched
}

/** Staff (or Claude) sort transactions: onto a Job, as overhead, or back to unsorted. */
export async function assignTransactions(db: Db, input: { ids: string[]; to: 'job' | 'overhead' | 'unassigned'; jobId?: string | null }, by: string) {
  const ids = [...new Set(input.ids)].filter((x) => typeof x === 'string' && x.length <= 100)
  if (!ids.length || ids.length > 500) throw badRequest('Pick 1 to 500 transactions.')
  if (input.to === 'job') {
    if (!input.jobId || !(await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, input.jobId)).get())) throw new Response('Job not found', { status: 404 })
  }
  const set =
    input.to === 'job'
      ? { assignment: 'job', jobId: input.jobId!, assignedBy: by, assignedAt: new Date() }
      : input.to === 'overhead'
        ? { assignment: 'overhead', jobId: null, assignedBy: by, assignedAt: new Date() }
        : { assignment: null, jobId: null, assignedBy: null, assignedAt: null }
  const res = await db.update(qboTransactions).set(set).where(inArray(qboTransactions.id, ids)).returning({ id: qboTransactions.id })
  return { updated: res.length }
}

export type TxnFilter = { show?: 'unassigned' | 'job' | 'overhead' | 'all'; jobId?: string | null; from?: string | null; to?: string | null; search?: string | null; limit?: number }

export async function listTransactions(db: Db, f: TxnFilter = {}) {
  const conds = [eq(qboTransactions.deleted, false)]
  if (f.jobId) conds.push(eq(qboTransactions.jobId, f.jobId))
  else if (f.show === 'unassigned') conds.push(isNull(qboTransactions.assignment))
  else if (f.show === 'job' || f.show === 'overhead') conds.push(eq(qboTransactions.assignment, f.show))
  if (f.from) conds.push(sql`${qboTransactions.txnDate} >= ${f.from}`)
  if (f.to) conds.push(sql`${qboTransactions.txnDate} <= ${f.to}`)
  const q = f.search?.trim().toLowerCase()
  if (q) {
    const p = `%${q.replace(/[%_\\]/g, '')}%`
    conds.push(sql`(lower(coalesce(${qboTransactions.partyName}, '')) LIKE ${p} OR lower(coalesce(${qboTransactions.memo}, '')) LIKE ${p} OR lower(coalesce(${qboTransactions.account}, '')) LIKE ${p} OR lower(coalesce(${qboTransactions.linesJson}, '')) LIKE ${p})`)
  }
  return db
    .select()
    .from(qboTransactions)
    .where(and(...conds))
    .orderBy(desc(qboTransactions.txnDate), desc(qboTransactions.id))
    .limit(Math.min(Math.max(f.limit ?? 500, 1), 2000))
}

/** A Job's QuickBooks transactions and totals (jobTotals). */
export async function jobFinancials(db: Db, jobId: string) {
  const rows = await listTransactions(db, { jobId, limit: 2000 })
  return { totals: jobTotals(rows), transactions: rows }
}

/** Settings and the MCP: connected or not, last sync, last error. Never tokens. */
export async function qboStatus(db: Db, env: QboEnv) {
  const conn = await db.select().from(qboConnection).where(eq(qboConnection.id, 1)).get()
  const counts = await db
    .select({ unassigned: sql<number>`sum(case when ${qboTransactions.assignment} is null then 1 else 0 end)`, total: sql<number>`count(*)` })
    .from(qboTransactions)
    .where(eq(qboTransactions.deleted, false))
    .get()
  return {
    hasKeys: Boolean(env.QBO_CLIENT_ID && env.QBO_CLIENT_SECRET),
    redirectUri: redirectUri(env),
    connected: conn ? { realmId: conn.realmId, connectedAt: conn.connectedAt.getTime(), refreshExpiresAt: conn.refreshExpiresAt.getTime() } : null,
    lastSyncAt: conn?.lastSyncAt?.getTime() ?? null,
    lastSyncError: conn?.lastSyncError ?? null,
    transactions: counts?.total ?? 0,
    unassigned: counts?.unassigned ?? 0,
  }
}
