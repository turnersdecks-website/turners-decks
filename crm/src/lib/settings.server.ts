import { eq } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { companySettings } from '#/db/schema'
import { validEmail } from '#/lib/intake'

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
