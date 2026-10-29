import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { user } from '#/db/schema'
import { requireAdmin, requireStaff } from '#/lib/guards'
import { readCompanySettings, saveCompanySettings } from '#/lib/settings.server'
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
  .handler(({ data }) => saveCompanySettings(env.DB, data))

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

