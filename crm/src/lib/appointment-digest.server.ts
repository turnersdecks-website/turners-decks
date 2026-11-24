import { and, asc, eq, gt, inArray, isNotNull, lt } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { getDb } from '#/db/client'
import { companySettings, leads, notificationJobs } from '#/db/schema'
import { appointmentWhen } from '#/lib/appointments.server'
import { localDay } from '#/lib/crew-time.server'
import { type OutboxEnv, enqueueJob, kickJobs } from '#/lib/outbox'
import { prettyPhone, toE164 } from '#/lib/phone'

// The evening heads-up to Pat (Kristin, Nov 23 2026): at 6 PM (company time zone) one text listing every appointment
// tomorrow, with time, name, address, phone and a link to the Lead. Nothing is sent on a day with no appointments.
// Sent from the Quo number as an `sms_owner` job (Staff's own phones, so no consent check), once per recipient per
// day: the dedupe key is the day plus the number, so the 5-minute cron can run this every time without repeats.
// ponytail: the text is written at 6 PM, so an appointment for tomorrow booked or moved after that is not in it.
// Upgrade path: a short "Added for tomorrow" text from bookAppointment when the digest for that day already went.

/** Hour of the day (company time zone) the text goes out. */
export const DIGEST_HOUR = 18

/** Recipients: the saved list, else Pat's cell. Invalid or repeated numbers are dropped. */
export function appointmentDigestRecipients(s: { appointmentDigestTo: string | null; ownerMobile: string | null }): string[] {
  const raw = s.appointmentDigestTo?.trim() ? s.appointmentDigestTo.split(',') : s.ownerMobile ? [s.ownerMobile] : []
  return [...new Set(raw.map((p) => toE164(p.trim())).filter((p): p is string => !!p))]
}

/** "2026-11-28" -> the next calendar day. */
function nextDate(date: string) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

type DigestLead = { id: string; at: Date; firstName: string | null; lastName: string | null; phone: string | null; street: string | null; city: string | null }

/** The text: a heading with tomorrow's date, then one block per appointment in time order. */
export function appointmentDigestText(list: DigestLead[], timeZone: string, crmUrl: string) {
  const day = appointmentWhen(list[0].at.getTime(), timeZone).date
  const heading = list.length === 1 ? `Tomorrow, ${day}: 1 appointment.` : `Tomorrow, ${day}: ${list.length} appointments.`
  const blocks = list.map((l) => {
    const name = [l.firstName, l.lastName].filter(Boolean).join(' ') || 'No name'
    const details = [[l.street, l.city].filter(Boolean).join(', '), l.phone ? prettyPhone(l.phone) : null].filter(Boolean)
    return [`${appointmentWhen(l.at.getTime(), timeZone).time} ${name}`, ...details, `${crmUrl.replace(/\/+$/, '')}/leads/${l.id}`].join('\n')
  })
  return [heading, ...blocks].join('\n\n')
}

/** Run by the 5-minute cron: from 6 PM to 11 PM, queues the day's text to each recipient that has not had it. */
export async function sendAppointmentDigest(env: OutboxEnv, now = Date.now()) {
  const db = getDb(env.DB)
  const s = await db
    .select({
      on: companySettings.appointmentDigestEnabled,
      texting: companySettings.textingEnabled,
      ownerMobile: companySettings.ownerMobile,
      appointmentDigestTo: companySettings.appointmentDigestTo,
      tz: companySettings.timezone,
    })
    .from(companySettings)
    .where(eq(companySettings.id, 1))
    .get()
  if (!s?.on || !s.texting) return { sent: 0 }
  const recipients = appointmentDigestRecipients(s)
  if (!recipients.length) return { sent: 0 }
  const { date, hour } = localDay(now, s.tz)
  if (hour < DIGEST_HOUR || hour >= 23) return { sent: 0 }

  const tomorrow = nextDate(date)
  // Tomorrow is within the next 30 hours (6 PM to midnight is at most 6 hours, plus the 24-hour day, plus DST).
  const candidates = await db
    .select({ id: leads.id, at: leads.appointmentAt, firstName: leads.firstName, lastName: leads.lastName, phone: leads.phone, street: leads.street, city: leads.city })
    .from(leads)
    .where(and(isNotNull(leads.appointmentAt), gt(leads.appointmentAt, new Date(now)), lt(leads.appointmentAt, new Date(now + 30 * 60 * 60_000))))
    .orderBy(asc(leads.appointmentAt))
  const list = candidates.filter((l): l is DigestLead => l.at !== null && localDay(l.at.getTime(), s.tz).date === tomorrow)
  if (!list.length) return { sent: 0 }

  const keys = recipients.map((to) => ({ to, key: `appt_digest:${tomorrow}:${to}` }))
  const already = new Set(
    (await db.select({ key: notificationJobs.dedupeKey }).from(notificationJobs).where(inArray(notificationJobs.dedupeKey, keys.map((k) => k.key)))).map((r) => r.key),
  )
  const due = keys.filter((k) => !already.has(k.key))
  if (!due.length) return { sent: 0 }
  const content = appointmentDigestText(list, s.tz, env.BETTER_AUTH_URL)
  const jobs = due.map((k) => enqueueJob(db, { kind: 'sms_owner', dedupeKey: k.key, payload: { to: k.to, content }, envelope: { to: [k.to], subject: "Text: tomorrow's appointments" } }))
  await db.batch(jobs.map((j) => j.insert) as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  kickJobs(env, jobs.map((j) => j.id))
  return { sent: jobs.length }
}
