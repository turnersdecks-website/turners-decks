import { describe, expect, it } from 'vitest'
import { createLead, updateLead } from '#/lib/leads.functions'
import { insertLead, leadRow } from './lead-helpers'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// Plan 006 D3: leads.address_key is written on every Lead address write.

const edits = {
  firstName: 'Hannah',
  lastName: 'Harbor',
  email: '',
  phone: '',
  street: '3 Pier Road Apt 2',
  city: 'Cape Porpoise',
  state: 'PA',
  zip: '04014',
  serviceType: '',
  message: '',
}

describe('Lead address key', () => {
  it('updateLead stores the key of the new address; removing the street clears it', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    expect((await callServerFn(updateLead, cookie, { leadId: id, ...edits })).status).toBe(200)
    expect(await leadRow(id)).toMatchObject({ address_key: '3 pier rd #2|04014' })

    expect((await callServerFn(updateLead, cookie, { leadId: id, ...edits, street: '' })).status).toBe(200)
    expect(await leadRow(id)).toMatchObject({ address_key: null })
  })

  it('createLead stores the key', async () => {
    const { cookie } = await signedInStaff('staff')

    const { id } = await serverFnResult<{ id: string }>(await callServerFn(createLead, cookie, edits))

    expect(await leadRow(id)).toMatchObject({ address_key: '3 pier rd #2|04014' })
  })
})
