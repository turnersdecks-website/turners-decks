import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { companySettings, customers, jobs, qboConnection, qboTransactions } from '#/db/schema'
import { badRequest } from '#/lib/input'
import { CREW_PAY_ACCOUNTS, OWNER_ACCOUNTS, QBO_ENTITIES, type QboEntity, type QboKind, type QboRules, jobTotals, marginPct, parseQboRules, ruleFor } from '#/lib/qbo-vocab'

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
export const BACKFILL_FROM = '2026-01-01'
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

/** Intuit's request id (intuit_tid header), kept in error messages so Intuit support can trace a failed call. */
function tidNote(res: Response) {
  const tid = res.headers.get('intuit_tid')
  return tid ? ` [intuit_tid ${tid}]` : ''
}

async function tokenCall(env: QboEnv, body: Record<string, string>, deps: QboDeps): Promise<TokenResponse> {
  if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET) throw badRequest('QBO_CLIENT_ID and QBO_CLIENT_SECRET are not set.')
  const res = await (deps.fetch ?? fetch)(TOKEN_URL, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const json = await res.json<Partial<TokenResponse> & { error?: string }>().catch(() => ({}) as Partial<TokenResponse> & { error?: string })
  if (json.error === 'invalid_grant') throw new Error(`QuickBooks access has expired or was revoked. Reconnect QuickBooks in Settings › Connections.${tidNote(res)}`)
  if (!res.ok || !json.access_token || !json.refresh_token) throw new Error(`QuickBooks sign-in failed (${res.status}${json.error ? `: ${json.error}` : ''})${tidNote(res)}`)
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
  if (!res.ok) throw new Error(`QuickBooks answered ${res.status} for ${path}${tidNote(res)}: ${(await res.text()).slice(0, 300)}`)
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
    // Nothing dated before BACKFILL_FROM is kept, even when CDC reports an edit to an older record. A deletion still
    // applies (it only marks a row we may already hold).
    // Owner's pay and personal spending is never copied (OWNER_ACCOUNTS); a record moved into one of those accounts is
    // removed below.
    const isOwner = (r: (typeof rows)[number]) => !!r.account && (OWNER_ACCOUNTS as readonly string[]).includes(r.account)
    const kept = rows.filter((r) => r.deleted || ((!r.txnDate || r.txnDate >= BACKFILL_FROM) && !isOwner(r)))
    const movedToOwner = rows.filter(isOwner).map((r) => r.id)
    for (let i = 0; i < movedToOwner.length; i += 90) await db.delete(qboTransactions).where(inArray(qboTransactions.id, movedToOwner.slice(i, i + 90)))
    // New costs the rules say to ignore arrive Ignored; a transaction already in the CRM keeps how it was sorted.
    const rules = await readQboRules(db)
    const fresh = kept.filter((r) => !r.deleted)
    const known = new Set<string>()
    for (let i = 0; i < fresh.length; i += 90) {
      for (const r of await db.select({ id: qboTransactions.id }).from(qboTransactions).where(inArray(qboTransactions.id, fresh.slice(i, i + 90).map((x) => x.id)))) known.add(r.id)
    }
    const at = new Date(startedAt)
    for (const r of fresh) if (!known.has(r.id) && ruleFor(r, rules) === 'ignore') Object.assign(r, { assignment: 'ignored', assignedBy: 'rule', assignedAt: at })
    await saveRows(db, kept)
    if (!conn.companyName) {
      const info = await qboGet<{ CompanyInfo?: { CompanyName?: string } }>(env, conn.realmId, token, `companyinfo/${encodeURIComponent(conn.realmId)}`, {}, deps).catch(() => null)
      const name = info?.CompanyInfo?.CompanyName?.trim()
      if (name) await db.update(qboConnection).set({ companyName: name }).where(eq(qboConnection.id, 1))
    }
    const matched = await autoMatch(db)
    await db
      .update(qboConnection)
      .set({ lastSyncAt: new Date(startedAt), lastSyncError: null, ...(full ? { backfilledAt: new Date(startedAt) } : {}) })
      .where(eq(qboConnection.id, 1))
    return { mode: full ? 'full' : 'changes', saved: kept.length, matched }
  } catch (err) {
    const message = err instanceof Response ? await err.clone().text() : String(err)
    console.error(JSON.stringify({ level: 'error', msg: 'quickbooks sync failed', error: message.slice(0, 1000) }))
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

/** Staff (or Claude) sort transactions: onto a Job, ignored (not a Job cost or payment), or back to unsorted. */
export async function assignTransactions(db: Db, input: { ids: string[]; to: 'job' | 'ignored' | 'unassigned'; jobId?: string | null }, by: string) {
  const ids = [...new Set(input.ids)].filter((x) => typeof x === 'string' && x.length <= 100)
  if (!ids.length || ids.length > 500) throw badRequest('Pick 1 to 500 transactions.')
  if (input.to === 'job') {
    if (!input.jobId || !(await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, input.jobId)).get())) throw new Response('Job not found', { status: 404 })
  }
  const set =
    input.to === 'job'
      ? { assignment: 'job', jobId: input.jobId!, assignedBy: by, assignedAt: new Date() }
      : input.to === 'ignored'
        ? { assignment: 'ignored', jobId: null, assignedBy: by, assignedAt: new Date() }
        : { assignment: null, jobId: null, assignedBy: null, assignedAt: null }
  // D1 allows 100 bound values per statement: 90 ids plus the 4 set values per update, all in one batch.
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 90) chunks.push(ids.slice(i, i + 90))
  const [first, ...rest] = chunks.map((c) => db.update(qboTransactions).set(set).where(inArray(qboTransactions.id, c)).returning({ id: qboTransactions.id }))
  const res = await db.batch([first!, ...rest])
  return { updated: res.reduce((n, r) => n + r.length, 0) }
}

export type TxnFilter = { show?: 'unassigned' | 'job' | 'ignored' | 'all'; jobId?: string | null; from?: string | null; to?: string | null; search?: string | null; limit?: number }

export async function listTransactions(db: Db, f: TxnFilter = {}) {
  const conds = [eq(qboTransactions.deleted, false)]
  if (f.jobId) conds.push(eq(qboTransactions.jobId, f.jobId))
  else if (f.show === 'unassigned') conds.push(isNull(qboTransactions.assignment))
  else if (f.show === 'job' || f.show === 'ignored') conds.push(eq(qboTransactions.assignment, f.show))
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
/**
 * Running numbers during a Job (Kristin, Nov 23 2026: "rough real time numbers during a job"). Crew time counts in the
 * P&L once verified as paid (crew-time.server.ts), which can be weeks after the work. Until then it is an estimate:
 * the Job's unverified crew time, less crew payments already in QuickBooks on the Job (CREW_PAY_ACCOUNTS) that no crew
 * time is linked to yet, so a Venmo to Gary and Gary's crew time are not both counted. Never below zero. When the
 * crew time is verified the estimate drops out and the real payment is in the costs.
 * ponytail: a crew payment booked to another account (e.g. Job Supplies) is not subtracted, so the estimate can run
 * high until that crew time is verified. Upgrade path: link the payment under Crew time (verify_crew_pay).
 */
export async function crewEstimates(db: Db, jobIds: string[]) {
  const out = new Map<string, { unverifiedCents: number; unlinkedCrewPayCents: number; estimateCents: number; months: Map<string, number> }>()
  if (!jobIds.length) return out
  const accounts = sql.join(CREW_PAY_ACCOUNTS.map((a) => sql`${a}`), sql`, `)
  for (let i = 0; i < jobIds.length; i += 90) {
    const ids = sql.join(jobIds.slice(i, i + 90).map((id) => sql`${id}`), sql`, `)
    const crew = await db.all<{ job_id: string; month: string; cents: number }>(
      sql`SELECT job_id, substr(work_date, 1, 7) AS month, coalesce(sum(cost_cents), 0) AS cents FROM crew_time
          WHERE paid_via IS NULL AND job_id IN (${ids}) GROUP BY 1, 2`,
    )
    const paid = await db.all<{ job_id: string; cents: number }>(
      sql`SELECT t.job_id, coalesce(sum(CASE t.kind WHEN 'cost' THEN t.amount_cents WHEN 'cost_credit' THEN -t.amount_cents ELSE 0 END), 0) AS cents
          FROM qbo_transactions t
          WHERE t.deleted = 0 AND t.assignment = 'job' AND t.job_id IN (${ids}) AND t.account IN (${accounts})
            AND NOT EXISTS (SELECT 1 FROM crew_time c WHERE c.qbo_txn_id = t.id)
          GROUP BY 1`,
    )
    const paidBy = new Map(paid.map((p) => [p.job_id, p.cents]))
    for (const c of crew) {
      const e = out.get(c.job_id) ?? { unverifiedCents: 0, unlinkedCrewPayCents: paidBy.get(c.job_id) ?? 0, estimateCents: 0, months: new Map() }
      e.unverifiedCents += c.cents
      e.months.set(c.month, (e.months.get(c.month) ?? 0) + c.cents)
      out.set(c.job_id, e)
    }
  }
  for (const e of out.values()) {
    e.estimateCents = Math.max(0, e.unverifiedCents - e.unlinkedCrewPayCents)
    // Spread the estimate over the months the crew worked, in proportion to their unverified time.
    const ratio = e.unverifiedCents > 0 ? e.estimateCents / e.unverifiedCents : 0
    let left = e.estimateCents
    const entries = [...e.months.entries()]
    entries.forEach(([m, cents], i) => {
      const share = i === entries.length - 1 ? left : Math.round(cents * ratio)
      e.months.set(m, share)
      left -= share
    })
  }
  return out
}

export async function jobFinancials(db: Db, jobId: string) {
  const rows = await listTransactions(db, { jobId, limit: 2000 })
  const crew = await db.get<{ outside: number; unverified: number; notes: string | null }>(
    sql`SELECT coalesce(sum(CASE WHEN paid_via = 'outside' THEN cost_cents END), 0) AS outside,
        coalesce(sum(CASE WHEN paid_via IS NULL THEN cost_cents END), 0) AS unverified,
        group_concat(DISTINCT CASE WHEN paid_via = 'outside' THEN paid_note END) AS notes
      FROM crew_time WHERE job_id = ${jobId}`,
  )
  const t = jobTotals(rows)
  const crewOutsideCents = crew?.outside ?? 0
  // All in: the QuickBooks costs plus crew paid outside QuickBooks, so crew pay counts once.
  const allInCostCents = t.costCents + crewOutsideCents
  // Plus crew time not verified as paid yet, as an estimate (crewEstimates).
  const est = (await crewEstimates(db, [jobId])).get(jobId)
  const crewEstimateCents = est?.estimateCents ?? 0
  const estimatedCostCents = allInCostCents + crewEstimateCents
  return {
    totals: {
      ...t,
      crewOutsideCents,
      crewOutsideNotes: crew?.notes ?? null,
      crewUnverifiedCents: crew?.unverified ?? 0,
      crewUnlinkedPayCents: est?.unlinkedCrewPayCents ?? 0,
      crewEstimateCents,
      allInCostCents,
      allInProfitCents: t.revenueCents - allInCostCents,
      allInMarginPct: marginPct(t.revenueCents, allInCostCents),
      estimatedCostCents,
    },
    transactions: rows,
  }
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

export const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'

/**
 * Settings > Connections > Disconnect: tells Intuit to revoke the tokens (best effort: a token Intuit already dropped
 * is fine) and deletes them here. Copied transactions and how they were sorted stay until someone asks to delete them.
 */
export async function disconnectQuickBooks(db: Db, env: QboEnv, deps: QboDeps = {}) {
  const conn = await db.select().from(qboConnection).where(eq(qboConnection.id, 1)).get()
  if (!conn) return { disconnected: false }
  if (env.QBO_CLIENT_ID && env.QBO_CLIENT_SECRET) {
    try {
      await (deps.fetch ?? fetch)(REVOKE_URL, {
        method: 'POST',
        headers: { authorization: `Basic ${btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`)}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ token: await unseal(env.BETTER_AUTH_SECRET, conn.refreshTokenEnc) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      console.error(JSON.stringify({ level: 'warn', msg: 'quickbooks revoke failed; deleting tokens anyway', error: String(err).slice(0, 200) }))
    }
  }
  await db.delete(qboConnection).where(eq(qboConnection.id, 1))
  return { disconnected: true }
}

// ---------------------------------------------------------------------------
// Profit and loss for a year (the P&L page). Money is counted by QuickBooks transaction date: revenue is invoiced net of
// credit memos; costs are net of vendor credits, split by how Staff sorted them (on a Job, not sorted yet; ignored ones are left out).
// Payments received are shown apart and never added to revenue. Completed Jobs are those marked done with a finish
// date in the year; their figures are every transaction sorted onto them, whatever its date.

export type PnlMonth = { month: string; revenueCents: number; jobCostCents: number; crewEstimateCents: number; unsortedCents: number; paidCents: number }

export async function profitAndLoss(db: Db, year: number) {
  const y = String(Math.trunc(year))
  const monthRows = await db
    .select({
      month: sql<string>`substr(${qboTransactions.txnDate}, 1, 7)`,
      revenueCents: sql<number>`coalesce(sum(CASE ${qboTransactions.kind} WHEN 'revenue' THEN ${qboTransactions.amountCents} WHEN 'revenue_credit' THEN -${qboTransactions.amountCents} ELSE 0 END), 0)`,
      jobCostCents: sql<number>`coalesce(sum(CASE WHEN ${qboTransactions.assignment} = 'job' THEN (CASE ${qboTransactions.kind} WHEN 'cost' THEN ${qboTransactions.amountCents} WHEN 'cost_credit' THEN -${qboTransactions.amountCents} ELSE 0 END) ELSE 0 END), 0)`,
      unsortedCents: sql<number>`coalesce(sum(CASE WHEN ${qboTransactions.assignment} IS NULL THEN (CASE ${qboTransactions.kind} WHEN 'cost' THEN ${qboTransactions.amountCents} WHEN 'cost_credit' THEN -${qboTransactions.amountCents} ELSE 0 END) ELSE 0 END), 0)`,
      paidCents: sql<number>`coalesce(sum(CASE ${qboTransactions.kind} WHEN 'payment' THEN ${qboTransactions.amountCents} ELSE 0 END), 0)`,
    })
    .from(qboTransactions)
    .where(and(eq(qboTransactions.deleted, false), sql`substr(${qboTransactions.txnDate}, 1, 4) = ${y}`))
    .groupBy(sql`substr(${qboTransactions.txnDate}, 1, 7)`)
  // Crew paid outside QuickBooks, by the month they worked: Job costs too (counted once, crew-time.server.ts).
  const crewOutside = await db.all<{ month: string; cents: number }>(
    sql`SELECT substr(work_date, 1, 7) AS month, coalesce(sum(cost_cents), 0) AS cents FROM crew_time WHERE paid_via = 'outside' AND substr(work_date, 1, 4) = ${y} GROUP BY 1`,
  )
  for (const c of crewOutside) {
    const m = monthRows.find((r) => r.month === c.month)
    if (m) m.jobCostCents += c.cents
    else monthRows.push({ month: c.month, revenueCents: 0, jobCostCents: c.cents, unsortedCents: 0, paidCents: 0 })
  }
  // Crew time not verified as paid yet, as an estimate in the months it was worked (crewEstimates).
  const estJobs = await db.all<{ job_id: string }>(sql`SELECT DISTINCT job_id FROM crew_time WHERE paid_via IS NULL AND substr(work_date, 1, 4) = ${y}`)
  const estimates = await crewEstimates(db, estJobs.map((j) => j.job_id))
  const crewEstimateByMonth = new Map<string, number>()
  for (const e of estimates.values()) for (const [m, c] of e.months) if (m.startsWith(y)) crewEstimateByMonth.set(m, (crewEstimateByMonth.get(m) ?? 0) + c)
  const byMonth = new Map(monthRows.map((m) => [m.month, m]))
  const months: PnlMonth[] = Array.from({ length: 12 }, (_, i) => {
    const month = `${y}-${String(i + 1).padStart(2, '0')}`
    const m = byMonth.get(month)
    const crewEstimateCents = crewEstimateByMonth.get(month) ?? 0
    return { month, revenueCents: m?.revenueCents ?? 0, jobCostCents: (m?.jobCostCents ?? 0) + crewEstimateCents, crewEstimateCents, unsortedCents: m?.unsortedCents ?? 0, paidCents: m?.paidCents ?? 0 }
  })
  const completedJobs = await db
    .select({
      id: jobs.id,
      name: jobs.name,
      finishDate: jobs.finishDate,
      first: customers.firstName,
      last: customers.lastName,
      revenueCents: sql<number>`(SELECT coalesce(sum(CASE t.kind WHEN 'revenue' THEN t.amount_cents WHEN 'revenue_credit' THEN -t.amount_cents ELSE 0 END), 0) FROM qbo_transactions t WHERE t.job_id = ${jobs.id} AND t.deleted = 0)`,
      // QuickBooks costs, plus crew time verified as paid outside QuickBooks (cash...), so crew pay counts once
      // (crew-time.server.ts): crew time covered by a QuickBooks payment is already in the QuickBooks costs.
      costCents: sql<number>`(SELECT coalesce(sum(CASE t.kind WHEN 'cost' THEN t.amount_cents WHEN 'cost_credit' THEN -t.amount_cents ELSE 0 END), 0) FROM qbo_transactions t WHERE t.job_id = ${jobs.id} AND t.deleted = 0)
        + (SELECT coalesce(sum(c.cost_cents), 0) FROM crew_time c WHERE c.job_id = ${jobs.id} AND c.paid_via = 'outside')`,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(eq(jobs.status, 'done'), sql`substr(${jobs.finishDate}, 1, 4) = ${y}`))
    .orderBy(desc(jobs.finishDate))
  const years = await db
    .select({ year: sql<string>`DISTINCT substr(${qboTransactions.txnDate}, 1, 4)` })
    .from(qboTransactions)
    .where(eq(qboTransactions.deleted, false))
  const doneEst = await crewEstimates(db, completedJobs.map((j) => j.id))
  const jobsWithEstimates = completedJobs.map((j) => {
    const crewEstimateCents = doneEst.get(j.id)?.estimateCents ?? 0
    return { ...j, costCents: j.costCents + crewEstimateCents, crewEstimateCents }
  })
  return { year: Number(y), months, completedJobs: jobsWithEstimates, years: years.map((r) => Number(r.year)).filter(Number.isFinite) }
}

// ---------------------------------------------------------------------------
// Sorting rules (QboRules, qbo-vocab.ts), kept on company_settings.

export async function readQboRules(db: Db): Promise<QboRules> {
  const row = await db.select({ rules: companySettings.qboRules }).from(companySettings).where(eq(companySettings.id, 1)).get()
  return parseQboRules(row?.rules ?? null)
}

export async function saveQboRules(db: Db, raw: unknown) {
  const rules = parseQboRules(raw)
  await db.update(companySettings).set({ qboRules: JSON.stringify(rules) }).where(eq(companySettings.id, 1))
  return rules
}

/** Settings: the rules, and every account seen so far (to choose from). */
export async function qboRulesView(db: Db) {
  const rules = await readQboRules(db)
  const seen = await db
    .select({ account: qboTransactions.account, n: sql<number>`count(*)` })
    .from(qboTransactions)
    .where(and(eq(qboTransactions.deleted, false), sql`${qboTransactions.kind} IN ('cost', 'cost_credit')`, sql`${qboTransactions.account} IS NOT NULL`))
    .groupBy(qboTransactions.account)
  const accounts = [...new Set([...rules.sortAccounts, ...seen.map((r) => r.account!).filter((a) => !(OWNER_ACCOUNTS as readonly string[]).includes(a))])].sort((a, b) => a.localeCompare(b))
  return { rules, accounts }
}

/** Settings > "Apply to To sort": run the rules over costs nobody has sorted yet. Returns how many were ignored. */
export async function applyQboRulesToUnsorted(db: Db, by: string) {
  const rules = await readQboRules(db)
  const open = await db
    .select({ id: qboTransactions.id, kind: qboTransactions.kind, account: qboTransactions.account, partyName: qboTransactions.partyName, memo: qboTransactions.memo })
    .from(qboTransactions)
    .where(and(eq(qboTransactions.deleted, false), isNull(qboTransactions.assignment)))
  const ids = open.filter((t) => ruleFor(t, rules) === 'ignore').map((t) => t.id)
  if (!ids.length) return { ignored: 0 }
  const res = await assignTransactions(db, { ids: ids.slice(0, 500), to: 'ignored' }, by)
  let n = res.updated
  for (let i = 500; i < ids.length; i += 500) n += (await assignTransactions(db, { ids: ids.slice(i, i + 500), to: 'ignored' }, by)).updated
  return { ignored: n }
}
