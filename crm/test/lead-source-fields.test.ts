import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createLead, moveLeadStage, updateLead } from '#/lib/leads.functions'
import { randomPhone } from './intake-helpers'
import { leadRow } from './lead-helpers'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// GLOSSARY How they found us, Referred by, Client type: kept on the Lead and carried to the Customer when it is won.

const uniqueEmail = () => `${crypto.randomUUID()}@example.com`
const customerOfLead = (leadId: string) =>
  env.DB.prepare('SELECT c.* FROM customers c JOIN leads l ON l.customer_id = c.id WHERE l.id = ?').bind(leadId).first<Record<string, unknown>>()
const insertCustomer = async (cols: { email?: string; howFound?: string | null } = {}) => {
  const id = crypto.randomUUID()
  const email = cols.email ?? uniqueEmail()
  await env.DB.prepare(
    `INSERT INTO customers (id, first_name, email, email_lower, how_found, customer_since, created_at, updated_at) VALUES (?, 'Mark', ?, ?, ?, 1, 1, 1)`,
  )
    .bind(id, email, email.toLowerCase(), cols.howFound ?? null)
    .run()
  return id
}

async function addLead(cookie: string, extra: Record<string, unknown>) {
  const res = await callServerFn(createLead, cookie, { firstName: 'Tom', phone: randomPhone(), email: uniqueEmail(), ...extra })
  return res
}

describe('how they found us, referred by and client type on a Lead', () => {
  it('a hand-added Lead keeps them, and defaults to residential', async () => {
    const { cookie } = await signedInStaff('staff')
    const mark = await insertCustomer()
    const { id } = await serverFnResult<{ id: string }>(await addLead(cookie, { howFound: 'Referral', referredById: mark, referredByName: '' }))
    expect(await leadRow(id)).toMatchObject({ how_found: 'Referral', referred_by_id: mark, referred_by_name: null, client_type: 'residential' })
  })

  it('refuses a Referred by that is not a Customer, and a client type that is not residential or commercial', async () => {
    const { cookie } = await signedInStaff('staff')
    expect((await addLead(cookie, { referredById: crypto.randomUUID() })).status).toBe(400)
    expect((await addLead(cookie, { clientType: 'industrial' })).status).toBe(400)
  })

  it('an edit can mark a Lead commercial and name a referrer who is not a Customer', async () => {
    const { cookie } = await signedInStaff('staff')
    const { id } = await serverFnResult<{ id: string }>(await addLead(cookie, {}))
    const res = await callServerFn(updateLead, cookie, { leadId: id, firstName: 'Roy', clientType: 'commercial', howFound: 'Saw a job nearby', referredByName: 'Kristin' })
    expect(res.status).toBe(200)
    expect(await leadRow(id)).toMatchObject({ client_type: 'commercial', how_found: 'Saw a job nearby', referred_by_name: 'Kristin' })
  })

  it('winning the Lead gives the new Customer the same answers', async () => {
    const { cookie } = await signedInStaff('staff')
    const mark = await insertCustomer()
    const { id } = await serverFnResult<{ id: string }>(await addLead(cookie, { howFound: 'Referral', referredById: mark, clientType: 'commercial' }))
    await serverFnResult(await callServerFn(moveLeadStage, cookie, { leadId: id, stage: 'won' }))
    expect(await customerOfLead(id)).toMatchObject({ how_found: 'Referral', referred_by_id: mark, client_type: 'commercial' })
  })

  it('a past Customer won again keeps what is on file and only fills blanks', async () => {
    const { cookie } = await signedInStaff('staff')
    const email = uniqueEmail()
    const past = await insertCustomer({ email, howFound: 'Google search' })
    const { id } = await serverFnResult<{ id: string }>(await addLead(cookie, { email, howFound: 'Facebook', referredByName: 'Kristin' }))
    await serverFnResult(await callServerFn(moveLeadStage, cookie, { leadId: id, stage: 'won' }))
    expect(await customerOfLead(id)).toMatchObject({ id: past, how_found: 'Google search', referred_by_name: 'Kristin' })
  })
})
