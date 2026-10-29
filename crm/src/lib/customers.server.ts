import { and, desc, eq, inArray, like, ne, or, sql } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { customers, jobs, leads } from '#/db/schema'
import { badRequest, optionalText } from '#/lib/input'
import { validEmail } from '#/lib/intake'
import { toE164 } from '#/lib/phone'
import { CLOSED_JOB_STATUSES, JOB_STATUSES, type JobStatus } from '#/lib/job-statuses'

// Customers and Jobs (GLOSSARY), shared by the CRM pages (customers.functions.ts) and the MCP tools (src/mcp/).
// Every function takes the database and validated-or-raw input and throws a Response (400/404/409) on bad input,
// like the Lead helpers in leads.server.ts.

type Db = ReturnType<typeof getDb>

export const customerNotFound = () => new Response('Customer not found', { status: 404 })
export const jobNotFound = () => new Response('Job not found', { status: 404 })

// ---------------------------------------------------------------------------
// Field parsing. Updates are partial: only the keys present in the input change, so an MCP caller can set one field
// and the CRM form can send them all.

const has = (data: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(data, k) && data[k] !== undefined

function optionalBool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw badRequest(`${label} must be true or false.`)
  return value
}

/** Dollars (number, or text like "$1,250.50") to whole cents; null when empty. Up to $10,000,000. */
export function parseMoney(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : NaN
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw badRequest(`${label} must be a dollar amount from 0 to 10,000,000.`)
  return Math.round(n * 100)
}

function optionalNumber(value: unknown, label: string, max: number): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '')) : NaN
  if (!Number.isFinite(n) || n < 0 || n > max) throw badRequest(`${label} must be a number from 0 to ${max.toLocaleString('en-US')}.`)
  return Math.round(n * 100) / 100
}

/** 'YYYY-MM-DD' (a real calendar date) or null. */
export function optionalDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${label} must be a date like 2027-04-15.`)
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw badRequest(`${label} is not a real date.`)
  return value
}

/** Epoch ms, or a 'YYYY-MM-DD' date (noon UTC, so it reads as that day in any US time zone), or null. */
function optionalInstant(value: unknown, label: string): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return new Date(value)
  if (typeof value === 'string') return new Date(`${optionalDate(value, label)}T12:00:00Z`)
  throw badRequest(`${label} must be a date like 2024-06-01.`)
}

/** The Customer fields present in `data`, validated and normalised. */
export function customerChanges(data: Record<string, unknown>) {
  const out: Partial<typeof customers.$inferInsert> = {}
  const text = (k: keyof typeof out & string, max: number) => {
    if (has(data, k)) (out as Record<string, unknown>)[k] = optionalText(data[k], max)
  }
  text('firstName', 100)
  text('lastName', 100)
  text('street', 200)
  text('city', 100)
  text('state', 50)
  text('zip', 20)
  text('howFound', 100)
  text('notes', 8000)
  if (has(data, 'email')) {
    const email = optionalText(data.email, 200)
    if (email && !validEmail(email)) throw badRequest('Email looks wrong.')
    out.email = email
    out.emailLower = email?.toLowerCase() ?? null
  }
  if (has(data, 'phone')) {
    const phone = optionalText(data.phone, 50)
    out.phone = phone
    out.phoneE164 = toE164(phone)
  }
  if (has(data, 'customerSince')) out.customerSince = optionalInstant(data.customerSince, 'Customer since')
  if (has(data, 'reviewLeft')) out.reviewLeft = optionalBool(data.reviewLeft, 'Review left')
  if (has(data, 'okToContact')) out.okToContact = optionalBool(data.okToContact, 'OK to contact again')
  if (has(data, 'referredById')) out.referredById = data.referredById === null || data.referredById === '' ? null : optionalText(data.referredById, 100)
  return out
}

/** The Job fields present in `data`, validated and normalised. Money in dollars; dates 'YYYY-MM-DD'. */
export function jobChanges(data: Record<string, unknown>) {
  const out: Partial<typeof jobs.$inferInsert> = {}
  if (has(data, 'name')) {
    const name = optionalText(data.name, 200)
    if (!name) throw badRequest('A Job needs a name.')
    out.name = name
  }
  if (has(data, 'city')) out.city = optionalText(data.city, 100)
  if (has(data, 'projectType')) out.projectType = optionalText(data.projectType, 100)
  if (has(data, 'material')) out.material = optionalText(data.material, 100)
  if (has(data, 'notes')) out.notes = optionalText(data.notes, 8000)
  if (has(data, 'status')) {
    if (!JOB_STATUSES.includes(data.status as JobStatus)) throw badRequest(`Status is one of: ${JOB_STATUSES.join(', ')}.`)
    out.status = data.status as JobStatus
  }
  if (has(data, 'startDate')) out.startDate = optionalDate(data.startDate, 'Start date')
  if (has(data, 'finishDate')) out.finishDate = optionalDate(data.finishDate, 'Finish date')
  if (has(data, 'squareFootage')) out.squareFootage = optionalNumber(data.squareFootage, 'Square footage', 100_000)
  if (has(data, 'actualLaborHours')) out.actualLaborHours = optionalNumber(data.actualLaborHours, 'Actual labor hours', 100_000)
  const money = [
    ['quotedPrice', 'quotedPriceCents', 'Quoted price'],
    ['quotedMaterialCost', 'quotedMaterialCostCents', 'Quoted material cost'],
    ['actualMaterialCost', 'actualMaterialCostCents', 'Actual material cost'],
    ['laborCost', 'laborCostCents', 'Labor cost'],
  ] as const
  for (const [k, col, label] of money) if (has(data, k)) out[col] = parseMoney(data[k], label)
  const flags = [
    ['permitNeeded', 'Permit needed'],
    ['permitPulled', 'Permit pulled'],
    ['hoaNeeded', 'HOA approval needed'],
    ['hoaApproved', 'HOA approved'],
    ['okToShowPhotos', 'OK to show photos'],
    ['onWebsite', 'On the website'],
    ['reviewAsked', 'Review asked'],
    ['reviewReceived', 'Review received'],
  ] as const
  for (const [k, label] of flags) if (has(data, k)) out[k] = optionalBool(data[k], label)
  return out
}

/** 409 if another Customer already has this phone or email (they are unique, like a Lead's). */
async function refuseCustomerClash(db: Db, f: { phoneE164?: string | null; emailLower?: string | null }, exceptId?: string) {
  if (!f.phoneE164 && !f.emailLower) return
  const clash = await db
    .select({ id: customers.id, firstName: customers.firstName, lastName: customers.lastName })
    .from(customers)
    .where(
      and(
        exceptId ? ne(customers.id, exceptId) : undefined,
        or(f.phoneE164 ? eq(customers.phoneE164, f.phoneE164) : undefined, f.emailLower ? eq(customers.emailLower, f.emailLower) : undefined),
      ),
    )
    .get()
  if (clash) {
    const name = [clash.firstName, clash.lastName].filter(Boolean).join(' ') || 'another Customer'
    throw new Response(`${name} (Customer ${clash.id}) already has this phone or email.`, { status: 409 })
  }
}

async function requireReferrer(db: Db, referredById: string | null | undefined, selfId?: string) {
  if (!referredById) return
  if (referredById === selfId) throw badRequest('A Customer cannot refer themselves.')
  const found = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, referredById)).get()
  if (!found) throw badRequest('"Referred by" is not an existing Customer.')
}

// ---------------------------------------------------------------------------
// Customers

export async function listCustomers(db: Db, opts: { search?: string | null; limit?: number } = {}) {
  const q = opts.search?.trim()
  // LIKE wildcards in the search are dropped rather than escaped.
  const pattern = q ? `%${q.replace(/[%_\\]/g, '')}%` : null
  const digits = q?.replace(/\D/g, '')
  return db
    .select({
      id: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
      email: customers.email,
      phone: customers.phone,
      city: customers.city,
      customerSince: customers.customerSince,
      howFound: customers.howFound,
      reviewLeft: customers.reviewLeft,
      jobsDone: sql<number>`(SELECT count(*) FROM ${jobs} WHERE ${jobs.customerId} = ${customers.id} AND ${jobs.status} = 'done')`,
      lastJobFinished: sql<string | null>`(SELECT max(${jobs.finishDate}) FROM ${jobs} WHERE ${jobs.customerId} = ${customers.id})`,
    })
    .from(customers)
    .where(
      pattern
        ? or(
            sql`(coalesce(${customers.firstName}, '') || ' ' || coalesce(${customers.lastName}, '')) LIKE ${pattern}`,
            like(customers.emailLower, pattern.toLowerCase()),
            like(customers.city, pattern),
            digits && digits.length >= 3 ? like(customers.phoneE164, `%${digits}%`) : undefined,
          )
        : undefined,
    )
    .orderBy(desc(customers.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 500, 1), 2000))
}

/** One Customer with their Jobs (newest first), their Leads, and who referred them / whom they referred. */
export async function getCustomer(db: Db, customerId: string) {
  const customer = await db.select().from(customers).where(eq(customers.id, customerId)).get()
  if (!customer) throw customerNotFound()
  const [customerJobs, customerLeads, referredBy, referred] = await Promise.all([
    db.select().from(jobs).where(eq(jobs.customerId, customerId)).orderBy(desc(jobs.createdAt)),
    db
      .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, stage: leads.stage, serviceType: leads.serviceType, createdAt: leads.createdAt })
      .from(leads)
      .where(eq(leads.customerId, customerId))
      .orderBy(desc(leads.createdAt)),
    customer.referredById
      ? db.select({ id: customers.id, firstName: customers.firstName, lastName: customers.lastName }).from(customers).where(eq(customers.id, customer.referredById)).get()
      : Promise.resolve(undefined),
    db.select({ id: customers.id, firstName: customers.firstName, lastName: customers.lastName }).from(customers).where(eq(customers.referredById, customerId)),
  ])
  const jobsDone = customerJobs.filter((j) => j.status === 'done').length
  const lastJobFinished = customerJobs.reduce<string | null>((max, j) => (j.finishDate && (!max || j.finishDate > max) ? j.finishDate : max), null)
  return { customer, jobs: customerJobs, leads: customerLeads, referredBy: referredBy ?? null, referred, jobsDone, lastJobFinished }
}

/** A Customer added by hand or imported. Needs a first or last name. */
export async function createCustomer(db: Db, data: Record<string, unknown>) {
  const fields = customerChanges(data)
  if (!fields.firstName && !fields.lastName) throw badRequest('A Customer needs a first or last name.')
  await refuseCustomerClash(db, fields)
  await requireReferrer(db, fields.referredById)
  const now = new Date()
  const id = crypto.randomUUID()
  const [row] = await db
    .insert(customers)
    .values({ id, ...fields, customerSince: fields.customerSince ?? now, createdAt: now, updatedAt: now })
    .returning()
  return row
}

export async function updateCustomer(db: Db, customerId: string, data: Record<string, unknown>) {
  const fields = customerChanges(data)
  if (!Object.keys(fields).length) throw badRequest('Nothing to change.')
  if ('firstName' in fields || 'lastName' in fields) {
    const current = await db.select({ firstName: customers.firstName, lastName: customers.lastName }).from(customers).where(eq(customers.id, customerId)).get()
    if (!current) throw customerNotFound()
    const first = 'firstName' in fields ? fields.firstName : current.firstName
    const last = 'lastName' in fields ? fields.lastName : current.lastName
    if (!first && !last) throw badRequest('A Customer needs a first or last name.')
  }
  await refuseCustomerClash(db, fields, customerId)
  await requireReferrer(db, fields.referredById, customerId)
  const saved = await db
    .update(customers)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(customers.id, customerId))
    .returning()
  if (!saved.length) throw customerNotFound()
  return saved[0]
}

// ---------------------------------------------------------------------------
// Jobs

export async function listJobs(db: Db, opts: { status?: JobStatus[] | null; customerId?: string | null; limit?: number } = {}) {
  const statuses = opts.status?.filter((s) => JOB_STATUSES.includes(s))
  return db
    .select({
      job: jobs,
      customerFirstName: customers.firstName,
      customerLastName: customers.lastName,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(statuses?.length ? inArray(jobs.status, statuses) : undefined, opts.customerId ? eq(jobs.customerId, opts.customerId) : undefined))
    .orderBy(desc(jobs.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 500, 1), 2000))
}

export async function getJob(db: Db, jobId: string) {
  const row = await db
    .select({ job: jobs, customer: { id: customers.id, firstName: customers.firstName, lastName: customers.lastName, phone: customers.phone, street: customers.street, city: customers.city } })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(eq(jobs.id, jobId))
    .get()
  if (!row) throw jobNotFound()
  return row
}

/** A Job for an existing Customer, optionally tied to one of their Leads. */
export async function createJob(db: Db, data: Record<string, unknown>) {
  const customerId = optionalText(data.customerId, 100)
  if (!customerId) throw badRequest('Which Customer is this Job for?')
  const customer = await db.select({ id: customers.id, city: customers.city }).from(customers).where(eq(customers.id, customerId)).get()
  if (!customer) throw customerNotFound()
  const leadId = optionalText(data.leadId, 100)
  if (leadId) {
    const lead = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).get()
    if (!lead) throw badRequest('That Lead does not exist.')
  }
  const fields = jobChanges(data)
  if (!fields.name) throw badRequest('A Job needs a name.')
  const now = new Date()
  const [row] = await db
    .insert(jobs)
    .values({ id: crypto.randomUUID(), customerId, leadId, ...fields, name: fields.name, city: 'city' in fields ? fields.city : customer.city, createdAt: now, updatedAt: now })
    .returning()
  return row
}

export async function updateJob(db: Db, jobId: string, data: Record<string, unknown>) {
  const fields = jobChanges(data)
  if (!Object.keys(fields).length) throw badRequest('Nothing to change.')
  const saved = await db
    .update(jobs)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(jobs.id, jobId))
    .returning()
  if (!saved.length) throw jobNotFound()
  return saved[0]
}

// ---------------------------------------------------------------------------
// A Lead is won (GLOSSARY Customer): D1 statements that go in the same batch as the stage move, AFTER it.
// 1. The Lead gets a Customer: the one it already has, else the Customer with its phone (or else its email), else a
//    new Customer made from the Lead's fields (customer since = now).
// 2. A Job for the Lead, only when this batch moved the Lead to won (`stageChangeId` is the stage history row the
//    move wrote) and the Lead has no open Job, so moving back and forth never makes a second one, while a past
//    Customer won again after their Job is done gets a new one.

export function wonWrites(d1: D1Database, leadId: string, stageChangeId: string, now: number) {
  const customerId = crypto.randomUUID()
  const closed = CLOSED_JOB_STATUSES.map((s) => `'${s}'`).join(', ')
  return [
    d1
      .prepare(
        `INSERT INTO customers (id, first_name, last_name, email, email_lower, phone, phone_e164, street, city, state, zip,
           customer_since, created_at, updated_at)
         SELECT ?, first_name, last_name, email, email_lower, phone, phone_e164, street, city, state, zip, ?, ?, ?
         FROM leads l
         WHERE l.id = ? AND l.stage = 'won' AND l.customer_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM customers c WHERE (l.phone_e164 IS NOT NULL AND c.phone_e164 = l.phone_e164)
                                                     OR (l.email_lower IS NOT NULL AND c.email_lower = l.email_lower))`,
      )
      .bind(customerId, now, now, now, leadId),
    d1
      .prepare(
        `UPDATE leads SET customer_id = coalesce(
           (SELECT c.id FROM customers c WHERE leads.phone_e164 IS NOT NULL AND c.phone_e164 = leads.phone_e164),
           (SELECT c.id FROM customers c WHERE leads.email_lower IS NOT NULL AND c.email_lower = leads.email_lower),
           (SELECT c.id FROM customers c WHERE c.id = ?))
         WHERE id = ? AND stage = 'won' AND customer_id IS NULL`,
      )
      .bind(customerId, leadId),
    d1
      .prepare(
        `INSERT INTO jobs (id, customer_id, lead_id, name, city, project_type, status, created_at, updated_at)
         SELECT ?, l.customer_id, l.id, coalesce(l.service_type, 'Deck project'), l.city, l.service_type, 'not_scheduled', ?, ?
         FROM leads l
         WHERE l.id = ? AND l.stage = 'won' AND l.customer_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM lead_stage_changes s WHERE s.id = ?)
           AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.lead_id = l.id AND j.status NOT IN (${closed}))`,
      )
      .bind(crypto.randomUUID(), now, now, leadId, stageChangeId),
  ]
}

/** The Customer a new Lead belongs to (phone first, then email), for Intake and hand-added Leads. */
export async function customerIdFor(db: Db, f: { phoneE164: string | null; emailLower: string | null }) {
  if (f.phoneE164) {
    const byPhone = await db.select({ id: customers.id }).from(customers).where(eq(customers.phoneE164, f.phoneE164)).get()
    if (byPhone) return byPhone.id
  }
  if (f.emailLower) {
    const byEmail = await db.select({ id: customers.id }).from(customers).where(eq(customers.emailLower, f.emailLower)).get()
    if (byEmail) return byEmail.id
  }
  return null
}
