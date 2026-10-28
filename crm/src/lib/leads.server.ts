import { and, eq, ne, or } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { leads } from '#/db/schema'
import { addressKey } from '#/lib/address-key'
import { badRequest, optionalText } from '#/lib/input'
import { toE164, validEmail } from '#/lib/intake'

// Server-only helpers for leads.functions.ts. Kept out of that module so its client build (handlers stripped)
// does not keep the schema import alive.

export const leadNotFound = () => new Response('Lead not found', { status: 404 })

// GLOSSARY Source: manual entry.
export const LEAD_SOURCE_MANUAL = 'manual'

// PLAN.md > Data model: these never change after insert. A write that names one is refused, not ignored.
export const FIRST_CONTACT_FIELDS = ['source', 'firstSource', 'firstTouchJson', 'createdAt'] as const

/** 409 if another Lead already has this phone or email (they are unique; Intake dedupes on them). */
export async function refuseClash(db: ReturnType<typeof getDb>, f: { phoneE164: string | null; emailLower: string | null }, exceptId?: string) {
  if (!f.phoneE164 && !f.emailLower) return
  const clash = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        exceptId ? ne(leads.id, exceptId) : undefined,
        or(f.phoneE164 ? eq(leads.phoneE164, f.phoneE164) : undefined, f.emailLower ? eq(leads.emailLower, f.emailLower) : undefined),
      ),
    )
    .get()
  if (clash) throw new Response('Another Lead already has this phone or email.', { status: 409 })
}

/** Validated, normalised Lead fields from Staff input (400 on bad input). */
export function leadFields(data: Record<string, unknown>) {
  const firstName = optionalText(data.firstName, 100)
  if (!firstName) throw badRequest('First name is required.')
  const email = optionalText(data.email, 200)
  if (email && !validEmail(email)) throw badRequest('Email looks wrong.')
  const phone = optionalText(data.phone, 50)
  const street = optionalText(data.street, 200)
  const zip = optionalText(data.zip, 20)
  return {
    firstName,
    lastName: optionalText(data.lastName, 100),
    email,
    emailLower: email?.toLowerCase() ?? null,
    phone,
    phoneE164: toE164(phone),
    street,
    city: optionalText(data.city, 100),
    state: optionalText(data.state, 50),
    zip,
    // Plan 006 D3: stored on every Lead address write.
    addressKey: addressKey({ street, zip }),
    serviceType: optionalText(data.serviceType, 100),
    message: optionalText(data.message, 4000),
  }
}

/** First sweep of a deleted Lead's Quote files, about 5 minutes after the delete (plan 009 decision 15). */
export const FIRST_SWEEP_AFTER_MS = 5 * 60_000

/**
 * Deletes a Lead in one D1 batch with the record of its R2 prefix (`leads/<id>/`) for the `r2-cleanup` cron, taken from
 * the Lead row itself, so it is written for every deleted Lead (files or not; an upload may be in flight) and for none
 * when there is no such Lead. Never reads lead_files or waits on R2. False when the Lead does not exist.
 */
export async function deleteLeadRecordingFiles(d1: D1Database, leadId: string, now = Date.now()): Promise<boolean> {
  const [, deleted] = await d1.batch([
    d1
      .prepare(`INSERT INTO r2_prefix_deletes (prefix, sweeps_done, next_sweep_at) SELECT 'leads/' || id || '/', 0, ? FROM leads WHERE id = ?`)
      .bind(now + FIRST_SWEEP_AFTER_MS, leadId),
    d1.prepare('DELETE FROM leads WHERE id = ? RETURNING id').bind(leadId),
  ])
  return deleted.results.length > 0
}

export function optionalCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1440) throw badRequest('Minutes must be 0-1440.')
  return value
}
