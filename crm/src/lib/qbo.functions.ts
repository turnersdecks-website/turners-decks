import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { customers, jobs } from '#/db/schema'
import { requireAdmin, requireStaff } from '#/lib/guards'
import { record } from '#/lib/input'
import { type TxnFilter, assignTransactions, jobFinancials, listTransactions, qboStatus, syncQuickBooks } from '#/lib/qbo.server'

// QuickBooks in the CRM (docs/adr/0006-quickbooks-sync.md). The work is in qbo.server.ts.

/** Admins: connection state for Settings > QuickBooks. */
export const getQboStatus = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(() => qboStatus(getDb(env.DB), env))

/** Admins: "Sync now". */
export const syncQboNow = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .handler(() => syncQuickBooks(getDb(env.DB), env))

/** Any Staff: transactions, filtered (Unassigned / On a Job / Overhead / All, dates, search). */
export const listQboTransactions = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: TxnFilter) => record(data))
  .handler(({ data }) => listTransactions(getDb(env.DB), data as TxnFilter))

/** Any Staff: put transactions on a Job, mark them overhead, or unsort them. QuickBooks is not changed. */
export const assignQboTransactions = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { ids: string[]; to: 'job' | 'overhead' | 'unassigned'; jobId?: string | null }) => record(data))
  .handler(({ data, context: { staff } }) =>
    assignTransactions(
      getDb(env.DB),
      {
        ids: Array.isArray(data.ids) ? (data.ids as string[]) : [],
        to: data.to === 'job' || data.to === 'overhead' ? data.to : 'unassigned',
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
