import { describe, expect, it } from 'vitest'
import { updateLead } from '#/lib/leads.functions'
import { CREATED_AT, insertLead, leadRow } from './lead-helpers'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// Lead detail edits (tests share one database, so phone/email are only set where a test needs them): last write wins (updated_at shown); first-contact fields are immutable after insert.

const edits = {
  firstName: 'Hannah',
  lastName: 'Harbor',
  email: '',
  phone: '',
  street: '3 Pier Rd',
  city: 'Cape Porpoise',
  state: 'PA',
  zip: '04014',
  serviceType: 'Roof repair',
  message: 'Leak over the porch',
}

describe('editing a Lead', () => {
  it('saves contact and address fields, normalising phone and email for dedupe', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    const res = await callServerFn(updateLead, cookie, { leadId: id, ...edits, email: 'Hannah@Example.com', phone: '(610) 555-0142' })

    expect(res.status).toBe(200)
    expect(await leadRow(id)).toMatchObject({
      last_name: 'Harbor',
      email: 'Hannah@Example.com',
      email_lower: 'hannah@example.com',
      phone: '(610) 555-0142',
      phone_e164: '+16105550142',
      street: '3 Pier Rd',
      city: 'Cape Porpoise',
      zip: '04014',
      service_type: 'Roof repair',
      message: 'Leak over the porch',
    })
  })

  it('last write wins: a second save overwrites the first and updated_at moves on each time', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    const first = await serverFnResult<{ updatedAt: Date }>(await callServerFn(updateLead, cookie, { leadId: id, ...edits, city: 'Biddeford' }))
    const second = await serverFnResult<{ updatedAt: Date }>(await callServerFn(updateLead, cookie, { leadId: id, ...edits, city: 'Saco' }))

    expect((await leadRow(id))?.city).toBe('Saco')
    expect(first.updatedAt.getTime()).toBeGreaterThan(CREATED_AT)
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime())
  })

  it.each([
    ['source', { source: 'manual' }],
    ['first_source', { firstSource: 'manual' }],
    ['first_touch_json', { firstTouchJson: '{}' }],
    ['created_at', { createdAt: new Date(0) }],
  ])('refuses to change %s (400) and saves nothing', async (_col, patch) => {
    const { cookie } = await signedInStaff('admin')
    const id = await insertLead()
    const before = await leadRow(id)

    const res = await callServerFn(updateLead, cookie, { leadId: id, ...edits, ...patch })

    expect(res.status).toBe(400)
    expect(await leadRow(id)).toEqual(before)
  })

  it('refuses a phone another Lead already has (409)', async () => {
    const { cookie } = await signedInStaff('staff')
    await insertLead({ phoneE164: '+16105550199' })
    const id = await insertLead()

    const res = await callServerFn(updateLead, cookie, { leadId: id, ...edits, phone: '610-555-0199' })

    expect(res.status).toBe(409)
    expect((await leadRow(id))?.phone_e164).toBeNull()
  })

  it('refuses an email another Lead already has (409)', async () => {
    const { cookie } = await signedInStaff('staff')
    const email = `taken-${crypto.randomUUID()}@example.com`
    await insertLead({ email })
    const id = await insertLead()

    const res = await callServerFn(updateLead, cookie, { leadId: id, ...edits, email: email.toUpperCase() })

    expect(res.status).toBe(409)
  })

  it('refuses a Lead with no first name (400)', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    expect((await callServerFn(updateLead, cookie, { leadId: id, ...edits, firstName: ' ' })).status).toBe(400)
  })

  it('answers 404 for an unknown Lead', async () => {
    const { cookie } = await signedInStaff('staff')

    expect((await callServerFn(updateLead, cookie, { leadId: crypto.randomUUID(), ...edits })).status).toBe(404)
  })
})
