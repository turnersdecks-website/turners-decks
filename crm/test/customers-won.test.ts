import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { moveLeadStage } from '#/lib/leads.functions'
import { inspectionFormPayload, mockSiteverify, postIntake, randomPhone } from './intake-helpers'
import { insertLead, leadRow } from './lead-helpers'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// GLOSSARY Customer and Job: a Lead that is won becomes (or joins) a Customer and gets a Job.

const uniqueEmail = () => `${crypto.randomUUID()}@example.com`

const customerOf = (leadId: string) =>
  env.DB.prepare('SELECT c.* FROM customers c JOIN leads l ON l.customer_id = c.id WHERE l.id = ?').bind(leadId).first<Record<string, unknown>>()
const jobsOf = (leadId: string) =>
  env.DB.prepare('SELECT * FROM jobs WHERE lead_id = ? ORDER BY created_at').bind(leadId).all<Record<string, unknown>>().then((r) => r.results)
const insertCustomer = async (cols: { phoneE164?: string | null; email?: string | null; firstName?: string }) => {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO customers (id, first_name, phone, phone_e164, email, email_lower, customer_since, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1)`,
  )
    .bind(id, cols.firstName ?? 'Past', cols.phoneE164 ?? null, cols.phoneE164 ?? null, cols.email ?? null, cols.email?.toLowerCase() ?? null)
    .run()
  return id
}

async function move(cookie: string, leadId: string, stage: string) {
  const res = await callServerFn(moveLeadStage, cookie, { leadId, stage })
  return serverFnResult<{ id: string; stage: string; customerId?: string | null }>(res)
}

describe('winning a Lead', () => {
  it('makes a Customer from the Lead and a Job for the project', async () => {
    const { cookie } = await signedInStaff('staff')
    const phone = `+1${randomPhone()}`
    const email = uniqueEmail()
    const leadId = await insertLead({ firstName: 'Wendy', lastName: 'Winner', phoneE164: phone, email, stage: 'quoted' })
    await env.DB.prepare("UPDATE leads SET service_type = 'Pool deck' WHERE id = ?").bind(leadId).run()

    const moved = await move(cookie, leadId, 'won')

    const customer = await customerOf(leadId)
    expect(customer).toMatchObject({ first_name: 'Wendy', last_name: 'Winner', phone_e164: phone, email_lower: email.toLowerCase(), street: '12 Main St', city: 'Douglassville' })
    expect(customer?.customer_since).toBeGreaterThan(1)
    expect(moved.customerId).toBe(customer?.id)
    const jobs = await jobsOf(leadId)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ customer_id: customer?.id, name: '12 Main St - Pool deck', project_type: 'Pool deck', city: 'Douglassville', status: 'not_scheduled' })
  })

  it('joins the past Customer with the same phone instead of making a second one', async () => {
    const { cookie } = await signedInStaff('staff')
    const phone = `+1${randomPhone()}`
    const pastId = await insertCustomer({ phoneE164: phone })
    const leadId = await insertLead({ phoneE164: phone, email: uniqueEmail() })

    await move(cookie, leadId, 'won')

    expect((await leadRow(leadId))?.customer_id).toBe(pastId)
    expect(await env.DB.prepare('SELECT count(*) AS n FROM customers WHERE phone_e164 = ?').bind(phone).first('n')).toBe(1)
    expect(await jobsOf(leadId)).toHaveLength(1)
  })

  it('joins the past Customer with the same email when the phone is new', async () => {
    const { cookie } = await signedInStaff('staff')
    const email = uniqueEmail()
    const pastId = await insertCustomer({ email })
    const leadId = await insertLead({ phoneE164: `+1${randomPhone()}`, email })

    await move(cookie, leadId, 'won')

    expect((await leadRow(leadId))?.customer_id).toBe(pastId)
  })

  it('moving a Lead off won and back does not make a second Job', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ phoneE164: `+1${randomPhone()}` })

    await move(cookie, leadId, 'won')
    await move(cookie, leadId, 'quoted')
    await move(cookie, leadId, 'won')

    expect(await jobsOf(leadId)).toHaveLength(1)
  })

  it('a Customer won again after their Job is done gets a new Job', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ phoneE164: `+1${randomPhone()}` })
    await move(cookie, leadId, 'won')
    await env.DB.prepare("UPDATE jobs SET status = 'done' WHERE lead_id = ?").bind(leadId).run()

    await move(cookie, leadId, 'quoted')
    await move(cookie, leadId, 'won')

    const jobs = await jobsOf(leadId)
    expect(jobs.map((j) => j.status)).toEqual(['done', 'not_scheduled'])
    expect(new Set(jobs.map((j) => j.customer_id)).size).toBe(1)
  })

  it('other stage moves leave the Lead without a Customer', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ phoneE164: `+1${randomPhone()}` })

    for (const stage of ['contacted', 'appointment', 'quoted', 'lost']) await move(cookie, leadId, stage)

    expect((await leadRow(leadId))?.customer_id).toBeNull()
    expect(await jobsOf(leadId)).toHaveLength(0)
  })

  it('a won Lead with no phone or email still gets its own Customer and Job', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ firstName: 'Walk', lastName: 'In' })

    await move(cookie, leadId, 'won')

    expect(await customerOf(leadId)).toMatchObject({ first_name: 'Walk', last_name: 'In', phone_e164: null, email_lower: null })
    expect(await jobsOf(leadId)).toHaveLength(1)
  })
})

describe('a past Customer contacting us again', () => {
  beforeEach(() => {
    mockSiteverify()
  })
  afterEach(() => vi.restoreAllMocks())

  it('their new website Lead is tied to their Customer record', async () => {
    const phone = randomPhone()
    const pastId = await insertCustomer({ phoneE164: `+1${phone}` })

    const res = await postIntake(inspectionFormPayload({ submission_key: crypto.randomUUID(), phone, email: uniqueEmail() }))

    expect(res.status).toBe(200)
    const { lead_id } = await res.json<{ lead_id: string }>()
    expect((await leadRow(lead_id))?.customer_id).toBe(pastId)
  })
})

describe('website form material', () => {
  beforeEach(() => {
    mockSiteverify()
  })
  afterEach(() => vi.restoreAllMocks())

  it('the quote form’s material and a timeline are kept on the new Lead', async () => {
    const res = await postIntake(inspectionFormPayload({ submission_key: crypto.randomUUID(), phone: randomPhone(), email: uniqueEmail(), material: 'Composite', timeline: 'This season' }))

    const { lead_id } = await res.json<{ lead_id: string }>()
    expect(await leadRow(lead_id)).toMatchObject({ preferred_material: 'Composite', timeframe: 'This season' })
  })
})
