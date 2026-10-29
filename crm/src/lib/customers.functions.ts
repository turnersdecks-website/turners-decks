import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { getDb } from '#/db/client'
import {
  createCustomer as createCustomerRecord,
  createJob as createJobRecord,
  getCustomer as getCustomerRecord,
  getJob as getJobRecord,
  listCustomers as listCustomerRows,
  listJobs as listJobRows,
  updateCustomer as updateCustomerRecord,
  updateJob as updateJobRecord,
} from '#/lib/customers.server'
import { requireStaff } from '#/lib/guards'
import { record, requiredId } from '#/lib/input'
import type { JobStatus } from '#/lib/job-statuses'

// Customers and Jobs (GLOSSARY) for the CRM pages. Any Staff member reads and edits them, as with Leads; there is no
// delete (a Customer's history is the point). The work is in customers.server.ts, shared with the MCP tools.

export const listCustomers = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(() => listCustomerRows(getDb(env.DB)))

export const getCustomer = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { customerId: string }) => record(data))
  .handler(({ data }) => getCustomerRecord(getDb(env.DB), requiredId(data.customerId)))

export type CustomerEdits = {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  howFound?: string
  notes?: string
  reviewLeft?: boolean
  okToContact?: boolean
  referredById?: string | null
  /** 'YYYY-MM-DD' */
  customerSince?: string | null
}

export const createCustomer = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: CustomerEdits) => record(data))
  .handler(({ data }) => createCustomerRecord(getDb(env.DB), data))

export const updateCustomer = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { customerId: string } & CustomerEdits) => record(data))
  .handler(({ data }) => {
    const { customerId, ...edits } = data
    return updateCustomerRecord(getDb(env.DB), requiredId(customerId), edits)
  })

export const listJobs = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(() => listJobRows(getDb(env.DB)))

export const getJob = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { jobId: string }) => record(data))
  .handler(({ data }) => getJobRecord(getDb(env.DB), requiredId(data.jobId)))

/** Money in dollars (number or text), dates 'YYYY-MM-DD'. */
export type JobEdits = {
  name?: string
  city?: string
  projectType?: string
  material?: string
  status?: JobStatus
  startDate?: string | null
  finishDate?: string | null
  squareFootage?: number | string | null
  quotedPrice?: number | string | null
  quotedMaterialCost?: number | string | null
  actualMaterialCost?: number | string | null
  laborCost?: number | string | null
  actualLaborHours?: number | string | null
  permitNeeded?: boolean
  permitPulled?: boolean
  hoaNeeded?: boolean
  hoaApproved?: boolean
  okToShowPhotos?: boolean
  onWebsite?: boolean
  reviewAsked?: boolean
  reviewReceived?: boolean
  notes?: string
}

export const createJob = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { customerId: string; leadId?: string } & JobEdits) => record(data))
  .handler(({ data }) => createJobRecord(getDb(env.DB), data))

export const updateJob = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { jobId: string } & JobEdits) => record(data))
  .handler(({ data }) => {
    const { jobId, ...edits } = data
    return updateJobRecord(getDb(env.DB), requiredId(jobId), edits)
  })
