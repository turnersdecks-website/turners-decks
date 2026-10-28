import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getCompanySettings, updateCompanySettings } from '#/lib/settings.functions'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// Company settings: any Staff member reads them (requireStaff); only admins change them (requireAdmin).

const valid = {
  name: 'Turner’s Decks LLC',
  phone: '(610) 555-0142',
  email: 'office@turnersdecks.com',
  serviceArea: 'Berks, Montgomery and Chester counties',
  businessNumber: '610-555-0142',
  timezone: 'America/New_York',
  ownerAlertEmails: 'pat@turnersdecks.com, Office@TurnersDecks.com',
}

const row = () => env.DB.prepare('SELECT * FROM company_settings WHERE id = 1').first()

describe('reading company settings', () => {
  it('a staff-role Staff member reads them', async () => {
    const { cookie } = await signedInStaff('staff')

    const settings = await serverFnResult<{ name: string; timezone: string; textingEnabled: boolean }>(
      await callServerFn(getCompanySettings, cookie),
    )

    expect(settings).toMatchObject({ name: "Turner's Decks", timezone: 'America/New_York', textingEnabled: false })
  })
})

describe('changing company settings', () => {
  it('rejects a staff-role Staff member (403) and changes nothing', async () => {
    const { cookie } = await signedInStaff('staff')
    const before = await row()

    const res = await callServerFn(updateCompanySettings, cookie, valid)

    expect(res.status).toBe(403)
    expect(await row()).toEqual(before)
  })

  it('an admin saves them; the Business line is stored as E.164 and Owner alert emails are normalised', async () => {
    const { cookie } = await signedInStaff('admin')

    const res = await callServerFn(updateCompanySettings, cookie, valid)

    expect(res.status).toBe(200)
    expect(await row()).toEqual({
      id: 1,
      name: 'Turner’s Decks LLC',
      phone: '(610) 555-0142',
      email: 'office@turnersdecks.com',
      service_area: 'Berks, Montgomery and Chester counties',
      business_number: '+16105550142',
      timezone: 'America/New_York',
      owner_alert_emails: 'pat@turnersdecks.com, office@turnersdecks.com',
      texting_enabled: 0,
    })
  })

  it('texting cannot be switched on from Settings (it waits for A2P approval)', async () => {
    const { cookie } = await signedInStaff('admin')

    await callServerFn(updateCompanySettings, cookie, { ...valid, textingEnabled: true })

    expect(await row()).toMatchObject({ texting_enabled: 0 })
  })

  it.each([
    ['an empty name', { name: '  ' }],
    ['a bad email', { email: 'not-an-email' }],
    ['a bad Owner alert email', { ownerAlertEmails: 'pat@turnersdecks.com, nope' }],
    ['a Business line that is not a US number', { businessNumber: '12345' }],
    ['an unknown timezone', { timezone: 'Mars/Olympus_Mons' }],
  ])('refuses %s (400) and changes nothing', async (_what, patch) => {
    const { cookie } = await signedInStaff('admin')
    const before = await row()

    const res = await callServerFn(updateCompanySettings, cookie, { ...valid, ...patch })

    expect(res.status).toBe(400)
    expect(await row()).toEqual(before)
  })
})
