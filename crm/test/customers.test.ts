import { describe, expect, it } from 'vitest'
import { createCustomer, createJob, getCustomer, listCustomers, updateCustomer, updateJob } from '#/lib/customers.functions'
import { jobMetrics } from '#/lib/customer-vocab'
import { randomPhone } from './intake-helpers'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// Customers and Jobs (GLOSSARY): added by hand or imported, edited by any Staff member.

type Customer = { id: string; firstName: string | null; phoneE164: string | null; email: string | null; okToContact: boolean; reviewLeft: boolean; notes: string | null; customerSince: string }
type Job = { id: string; name: string; status: string; quotedPriceCents: number | null; actualMaterialCostCents: number | null; laborCostCents: number | null; startDate: string | null; city: string | null; permitNeeded: boolean }

const newCustomer = async (cookie: string, fields: Record<string, unknown> = {}) =>
  serverFnResult<Customer>(await callServerFn(createCustomer, cookie, { firstName: 'Carla', lastName: 'Customer', phone: randomPhone(), city: 'Boyertown', ...fields }))

describe('Customers', () => {
  it('Staff add a Customer by hand; it shows in the list with no Jobs yet', async () => {
    const { cookie } = await signedInStaff('staff')

    const created = await newCustomer(cookie, { email: `${crypto.randomUUID()}@Example.com`, howFound: 'Referral' })

    expect(created).toMatchObject({ firstName: 'Carla', okToContact: true, reviewLeft: false })
    const rows = await serverFnResult<{ id: string; jobsDone: number }[]>(await callServerFn(listCustomers, cookie))
    expect(rows.find((r) => r.id === created.id)).toMatchObject({ jobsDone: 0 })
  })

  it('a Customer needs a first or last name', async () => {
    const { cookie } = await signedInStaff('staff')

    expect((await callServerFn(createCustomer, cookie, { phone: randomPhone() })).status).toBe(400)
  })

  it('a second Customer with the same phone is refused, naming the first', async () => {
    const { cookie } = await signedInStaff('staff')
    const phone = randomPhone()
    await newCustomer(cookie, { phone })

    const res = await callServerFn(createCustomer, cookie, { firstName: 'Other', phone })

    expect(res.status).toBe(409)
    expect(await res.text()).toContain('Carla Customer')
  })

  it('an edit changes only the fields it names', async () => {
    const { cookie } = await signedInStaff('staff')
    const c = await newCustomer(cookie, { notes: 'Has a dog' })

    const saved = await serverFnResult<Customer>(await callServerFn(updateCustomer, cookie, { customerId: c.id, reviewLeft: true }))

    expect(saved).toMatchObject({ reviewLeft: true, notes: 'Has a dog', firstName: 'Carla' })
  })

  it('a Customer cannot refer themselves, and a referrer must exist', async () => {
    const { cookie } = await signedInStaff('staff')
    const c = await newCustomer(cookie)

    expect((await callServerFn(updateCustomer, cookie, { customerId: c.id, referredById: c.id })).status).toBe(400)
    expect((await callServerFn(updateCustomer, cookie, { customerId: c.id, referredById: crypto.randomUUID() })).status).toBe(400)
  })

  it('the Customer page lists who they referred', async () => {
    const { cookie } = await signedInStaff('staff')
    const referrer = await newCustomer(cookie)
    const friend = await newCustomer(cookie, { firstName: 'Fran', referredById: referrer.id })

    const page = await serverFnResult<{ referred: { id: string }[] }>(await callServerFn(getCustomer, cookie, { customerId: referrer.id }))

    expect(page.referred.map((r) => r.id)).toEqual([friend.id])
  })

  it('an imported Customer keeps the date they became a Customer', async () => {
    const { cookie } = await signedInStaff('staff')

    const c = await newCustomer(cookie, { customerSince: '2021-06-01' })

    expect(new Date(c.customerSince).toISOString()).toBe('2021-06-01T12:00:00.000Z')
  })
})

describe('Jobs', () => {
  it('a Job takes dollars and stores cents, and starts in the Customer’s town', async () => {
    const { cookie } = await signedInStaff('staff')
    const c = await newCustomer(cookie)

    const job = await serverFnResult<Job>(await callServerFn(createJob, cookie, { customerId: c.id, name: 'Back deck', quotedPrice: '$28,500.50', permitNeeded: true }))

    expect(job).toMatchObject({ name: 'Back deck', status: 'not_scheduled', quotedPriceCents: 2_850_050, city: 'Boyertown', permitNeeded: true })
  })

  it('a Job needs a name and an existing Customer', async () => {
    const { cookie } = await signedInStaff('staff')
    const c = await newCustomer(cookie)

    expect((await callServerFn(createJob, cookie, { customerId: c.id })).status).toBe(400)
    expect((await callServerFn(createJob, cookie, { customerId: crypto.randomUUID(), name: 'x' })).status).toBe(404)
  })

  it.each([
    [{ startDate: '2027-02-30' }],
    [{ startDate: '04/15/2027' }],
    [{ status: 'finished' }],
    [{ quotedPrice: -5 }],
    [{ permitPulled: 'yes' }],
  ])('a bad value is refused: %o', async (edit) => {
    const { cookie } = await signedInStaff('staff')
    const c = await newCustomer(cookie)
    const job = await serverFnResult<Job>(await callServerFn(createJob, cookie, { customerId: c.id, name: 'Deck' }))

    expect((await callServerFn(updateJob, cookie, { jobId: job.id, ...edit })).status).toBe(400)
  })

  it('finishing a Job counts toward the Customer’s Jobs done and last Job finished', async () => {
    const { cookie } = await signedInStaff('staff')
    const c = await newCustomer(cookie)
    const job = await serverFnResult<Job>(await callServerFn(createJob, cookie, { customerId: c.id, name: 'Deck' }))

    await callServerFn(updateJob, cookie, { jobId: job.id, status: 'done', finishDate: '2027-05-20' })

    const page = await serverFnResult<{ jobsDone: number; lastJobFinished: string | null }>(await callServerFn(getCustomer, cookie, { customerId: c.id }))
    expect(page).toMatchObject({ jobsDone: 1, lastJobFinished: '2027-05-20' })
  })
})

describe('Job numbers', () => {
  const blank = { squareFootage: null, actualLaborHours: null, quotedPriceCents: null, quotedMaterialCostCents: null, actualMaterialCostCents: null, laborCostCents: null }

  it('works out labor hours per 100 sq ft, material variance and gross margin like the Airtable tracker', () => {
    expect(
      jobMetrics({ squareFootage: 320, actualLaborHours: 96, quotedPriceCents: 3_000_000, quotedMaterialCostCents: 1_000_000, actualMaterialCostCents: 1_150_000, laborCostCents: 900_000 }),
    ).toEqual({ laborHoursPer100Sqft: 30, materialVarianceCents: 150_000, grossMarginCents: 950_000, grossMarginPct: 32 })
  })

  it('leaves each number blank until its inputs are filled in', () => {
    expect(jobMetrics(blank)).toEqual({ laborHoursPer100Sqft: null, materialVarianceCents: null, grossMarginCents: null, grossMarginPct: null })
    expect(jobMetrics({ ...blank, quotedPriceCents: 100, actualMaterialCostCents: 50 }).grossMarginCents).toBeNull()
  })
})
