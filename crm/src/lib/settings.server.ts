import { eq } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { companySettings } from '#/db/schema'
import { badRequest, optionalText } from '#/lib/input'
import { validEmail } from '#/lib/intake'
import { toE164 } from '#/lib/phone'

// Server-only helpers for settings.functions.ts (kept apart so the client build drops the schema import).

export type CompanySettings = typeof companySettings.$inferSelect

export async function readCompanySettings(d1: D1Database): Promise<CompanySettings> {
  const row = await getDb(d1).select().from(companySettings).where(eq(companySettings.id, 1)).get()
  if (!row) throw new Error('company_settings row 1 is missing (migration 0003 seeds it)')
  return row
}

/** "a@x.com, B@y.com" -> lower-cased list; null if any entry is not an email or there are more than 10. */
export function parseOwnerAlertEmails(raw: string | null): string[] | null {
  const list = (raw ?? '').split(/[\s,;]+/).filter(Boolean)
  if (list.length > 10 || list.some((e) => !validEmail(e))) return null
  return [...new Set(list.map((e) => e.toLowerCase()))]
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Admin edit of company settings (settings.functions.ts updateCompanySettings, and the MCP). `texting_enabled` is not
 * editable here: it stays off until A2P approval (G1). Last write wins.
 */
export async function saveCompanySettings(d1: D1Database, data: Record<string, unknown>): Promise<CompanySettings> {
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

  await getDb(d1)
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
  return readCompanySettings(d1)
}
