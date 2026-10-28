// Dates on CRM pages are shown in the company timezone (company_settings.timezone), so the server render and
// the browser agree and "today" means the Owners' day, not UTC's.

/** YYYY-MM-DD of an instant in a timezone (en-CA formats dates that way). */
function dayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
}

export type FollowUpBucket = 'overdue' | 'today' | 'upcoming'

/** Which Follow-up queue section an open Follow-up due at `dueMs` belongs in, by calendar day in `timeZone`. */
export function followUpBucket(dueMs: number, nowMs: number, timeZone: string): FollowUpBucket {
  const due = dayKey(dueMs, timeZone)
  const today = dayKey(nowMs, timeZone)
  return due < today ? 'overdue' : due === today ? 'today' : 'upcoming'
}

/** "Oct 20, 2026, 9:30 PM" in the company timezone. */
export function formatWhen(value: Date | number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

/** "Oct 20, 2026" in the company timezone. */
export function formatDay(value: Date | number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'medium' }).format(value)
}

/** Monday 00:00 of the calendar week containing `nowMs`, in `timeZone` -> epoch ms ("this week" on Home). */
export function startOfWeek(nowMs: number, timeZone: string): number {
  const [y, m, d] = dayKey(nowMs, timeZone).split('-').map(Number)
  const daysSinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(y, m - 1, d - daysSinceMonday)).toISOString().slice(0, 10)
  return wallTimeToEpoch(`${monday}T00:00`, timeZone)
}

/** Minutes the zone is ahead of UTC at an instant (EDT -> -240). */
function offsetMinutes(ms: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(ms)
      .map((x) => [x.type, Number(x.value)]),
  )
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60_000
}

/** A `datetime-local` value ("2026-10-20T10:00") read as wall time in `timeZone` -> epoch ms. */
export function wallTimeToEpoch(local: string, timeZone: string): number {
  const [d, t = '00:00'] = local.split('T')
  const [y, mo, day] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const asUtc = Date.UTC(y, mo - 1, day, h, mi)
  const first = asUtc - offsetMinutes(asUtc, timeZone) * 60_000
  // Re-check at the result in case a DST change sits between the guess and the answer.
  return asUtc - offsetMinutes(first, timeZone) * 60_000
}
