import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { customers, jobs } from '#/db/schema'
import { requireAdmin, requireStaff } from '#/lib/guards'
import { record } from '#/lib/input'
import { type TxnFilter, applyQboRulesToUnsorted, assignTransactions, disconnectQuickBooks, jobFinancials, listTransactions, profitAndLoss, qboRulesView, qboStatus, saveQboRules, syncQuickBooks } from '#/lib/qbo.server'

// QuickBooks in the CRM (docs/adr/0006-quickbooks-sync.md). The work is in qbo.server.ts.

/** Admins: connection state for Settings > QuickBooks. */
export const getQboStatus = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(() => qboStatus(getDb(env.DB), env))

/** Any Staff: "Sync now" (Settings and the Transactions page). It only reads from QuickBooks. */
export const syncQboNow = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .handler(() => syncQuickBooks(getDb(env.DB), env))

/** Any Staff: transactions, filtered (To sort / On a Job / Ignored / All, dates, search). */
export const listQboTransactions = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: TxnFilter) => record(data))
  .handler(({ data }) => listTransactions(getDb(env.DB), data as TxnFilter))

/** Any Staff: put transactions on a Job, ignore them, or unsort them. QuickBooks is not changed. */
export const assignQboTransactions = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { ids: string[]; to: 'job' | 'ignored' | 'unassigned'; jobId?: string | null }) => record(data))
  .handler(({ data, context: { staff } }) =>
    assignTransactions(
      getDb(env.DB),
      {
        ids: Array.isArray(data.ids) ? (data.ids as string[]) : [],
        to: data.to === 'job' || data.to === 'ignored' ? data.to : 'unassigned',
        jobId: typeof data.jobId === 'string' ? data.jobId : null,
      },
      staff.id,
    ),
  )

/** Any Staff: a Job's QuickBooks money. */
export const getJobFinancials = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { jobId: string }) => record(data))
  .handler(({ data }) => jobFinancials(getDb(env.DB), String(data.jobId)))

/** Any Staff: Jobs to pick from (newest first), with the customer's name. */
export const listJobChoices = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(() =>
    getDb(env.DB)
      .select({ id: jobs.id, name: jobs.name, status: jobs.status, first: customers.firstName, last: customers.lastName })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .orderBy(desc(jobs.createdAt))
      .limit(500),
  )

/** Admins: revoke and forget the QuickBooks connection. */
export const disconnectQbo = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .handler(() => disconnectQuickBooks(getDb(env.DB), env))

/** Any Staff: the P&L for one year (profitAndLoss). */
export const getProfitAndLoss = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { year: number }) => record(data))
  .handler(({ data }) => profitAndLoss(getDb(env.DB), Number(data.year) || new Date().getFullYear()))

/** Admins: the sorting rules and the accounts seen so far. */
export const getQboRules = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(() => qboRulesView(getDb(env.DB)))

/** Admins: save the sorting rules (applies to new transactions from the next sync). */
export const saveQboRulesFn = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { sortAccounts: string[]; vendors: { vendor: string; action: 'sort' | 'ignore' }[] }) => record(data))
  .handler(({ data }) => saveQboRules(getDb(env.DB), data))

/** Admins: run the rules over everything in To sort now. */
export const applyQboRules = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .handler(({ context: { staff } }) => applyQboRulesToUnsorted(getDb(env.DB), staff.id))
