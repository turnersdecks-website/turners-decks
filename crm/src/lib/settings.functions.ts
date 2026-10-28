import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { companySettings, user } from '#/db/schema'
import { requireAdmin, requireStaff } from '#/lib/guards'
import { toE164, validEmail } from '#/lib/intake'
import { isTimeZone, parseOwnerAlertEmails, readCompanySettings } from '#/lib/settings.server'
import { badRequest, optionalText, record } from '#/lib/input'

export type CompanySettingsInput = {
  name: string
  phone: string
  email: string
  serviceArea: string
  businessNumber: string
  timezone: string
  ownerAlertEmails: string
}

/** The one company settings row (any Staff member). */
export const getCompanySettings = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(() => readCompanySettings(env.DB))

/**
 * Admin edit of company settings. `texting_enabled` is not editable here: it stays off until A2P approval (G1).
 * Last write wins.
 */
export const updateCompanySettings = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  // Validators run before middleware: never throw here, so an unauthenticated caller always gets 401 first.
  .validator((data: CompanySettingsInput) => record(data))
  .handler(async ({ data }) => {
    const name = optionalText(data.name, 200)
    if (!name) throw badRequest('Company name is required.')
    const email = optionalText(data.email, 200)
    if (email && !validEmail(email)) throw badRequest('Company email looks wrong.')
    const businessNumberRaw = optionalText(data.businessNumber, 50)
    const businessNumber = businessNumberRaw ? toE164(businessNumberRaw) : null
    if (businessNumberRaw && !businessNumber) throw badRequest('Business line must be a US phone number.')
    const timezone = optionalText(data.timezone, 64)
    if (!timezone || !isTimeZone(timezone)) throw badRequest('Unknown timezone.')
    const ownerAlertEmails = parseOwnerAlertEmails(optionalText(data.ownerAlertEmails, 2000))
    if (!ownerAlertEmails) throw badRequest('Each Owner alert email must be a valid address (up to 10).')

    await getDb(env.DB)
      .update(companySettings)
      .set({
        name,
        phone: optionalText(data.phone, 50),
        email,
        serviceArea: optionalText(data.serviceArea, 500),
        businessNumber,
        timezone,
        ownerAlertEmails: ownerAlertEmails.length ? ownerAlertEmails.join(', ') : null,
      })
      .where(eq(companySettings.id, 1))
    return readCompanySettings(env.DB)
  })

/** "Your profile": the signed-in Staff member renames themselves (never anyone else). */
export const updateProfileName = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { name: string }) => record(data))
  .handler(async ({ data, context: { staff } }) => {
    const name = optionalText(data.name, 100)
    if (!name) throw badRequest('Name is required.')
    await getDb(env.DB).update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, staff.id))
    return { name }
  })

