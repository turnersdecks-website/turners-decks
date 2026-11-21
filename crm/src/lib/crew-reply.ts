// Reads Pat's reply to the crew check-in text (crew-time.server.ts). Pure, client-safe, no database.
//
// Pat writes one person per comma or line: "Tommy 8, Gary $250, Lenny 6 at $30".
// - a plain number is hours ("Tommy 8", "tommy 7.5h", "Gary 8 hrs");
// - a dollar amount on its own is pay for the day ("Gary $250", "Gary 250 for the day", "Gary $250/day");
// - a rate is hourly pay ("Lenny 6 at $30", "Lenny 6 @30", "Lenny 6 $30/hr", "6 hrs 30 an hour");
// - no amount uses the person's usual pay from the crew list.
// Whole-reply words: NONE / nobody / rain / off = nobody worked; SAME = the same crew as that Job's last day; FIX =
// undo what was just recorded. Names match the crew list by name, first name or nickname (case-insensitive); a name
// not on the list is kept and flagged for review, never guessed.

export type CrewPick = { id: string; name: string; aliases: string | null; payType: 'hourly' | 'day' | null; rateCents: number | null }

export type ParsedEntry = {
  name: string
  crewMemberId: string | null
  hours: number | null
  payType: 'hourly' | 'day' | null
  rateCents: number | null
  costCents: number | null
  needsReview: boolean
  /** Why it needs review, in plain words. */
  problem?: string
}

export type ParsedReply =
  | { kind: 'entries'; entries: ParsedEntry[] }
  | { kind: 'none' }
  | { kind: 'same' }
  | { kind: 'fix' }
  | { kind: 'unreadable' }

const NONE = /^(none|nobody|no one|noone|no|nothing|rain|rained out|rain day|off|day off|didn'?t work|no work|zero)[.!]*$/i
const SAME = /^(same|same as (yesterday|last time|before)|same crew|same guys)[.!]*$/i
const FIX = /^(fix|wrong|undo|redo)[.!]*$/i

const norm = (s: string) => s.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Every name a crew member answers to. */
function namesOf(c: CrewPick) {
  const all = [c.name, c.name.split(/\s+/)[0], ...(c.aliases ?? '').split(',')]
  return [...new Set(all.map(norm).filter((n) => n.length >= 2))]
}

export function matchCrew(name: string, crew: CrewPick[]): CrewPick | null {
  const n = norm(name)
  if (!n) return null
  const exact = crew.filter((c) => namesOf(c).includes(n))
  if (exact.length === 1) return exact[0]
  // "Tom" for Tommy, "Tommy" for Tom: a prefix of at least 3 letters, only when it points at one person.
  const loose = crew.filter((c) => namesOf(c).some((k) => n.length >= 3 && k.length >= 3 && (k.startsWith(n) || n.startsWith(k))))
  return loose.length === 1 ? loose[0] : null
}

const money = (v: string) => Math.round(Number(v.replace(/[$,]/g, '')) * 100)

/** One person's part of the reply, e.g. "Lenny 6 at $30". */
function parseSegment(seg: string, crew: CrewPick[]): ParsedEntry | null {
  let rest = ` ${seg.trim()} `
  let hours: number | null = null
  let payType: 'hourly' | 'day' | null = null
  let rateCents: number | null = null

  // Hourly rate: "at $30", "@30", "$30/hr", "30 an hour", "$30 per hour".
  const hourly = rest.match(/(?:@|\bat\b)\s*\$?\s*(\d+(?:\.\d+)?)(?:\s*(?:\/\s*h(?:ou)?r|an?\s+h(?:ou)?r|per\s+h(?:ou)?r|\/hr|hr))?|\$?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*h(?:ou)?r\b|\s+an?\s+h(?:ou)?r\b|\s+per\s+h(?:ou)?r\b)/i)
  if (hourly) {
    payType = 'hourly'
    rateCents = money(hourly[1] ?? hourly[2])
    rest = rest.replace(hourly[0], ' ')
  }
  // Day pay: "$250", "250 for the day", "$250/day", "250 a day".
  const day = !hourly && rest.match(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*(?:\/\s*day|a\s+day|for\s+the\s+day|per\s+day|day))?|\b(\d+(?:\.\d+)?)\s*(?:\/\s*day|a\s+day|for\s+the\s+day|per\s+day)\b/i)
  if (day) {
    payType = 'day'
    rateCents = money(day[1] ?? day[2])
    rest = rest.replace(day[0], ' ')
  }
  // Hours: the first remaining number, with or without "h", "hrs", "hours".
  const h = rest.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)?\b/i)
  if (h) {
    const v = Number(h[1])
    if (v > 0 && v <= 24) hours = v
    rest = rest.replace(h[0], ' ')
  }
  const name = rest
    .replace(/\b(full day|all day|half day|worked|hrs?|hours?|for|the|day|and|at|was|did)\b/gi, ' ')
    .replace(/[^A-Za-z' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name) return null

  const member = matchCrew(name, crew)
  const entry: ParsedEntry = { name: member?.name ?? name, crewMemberId: member?.id ?? null, hours, payType, rateCents, costCents: null, needsReview: false }
  if (!member) {
    entry.needsReview = true
    entry.problem = `"${name}" isn't on the crew list`
  }
  // Fill in the usual pay when Pat gave none.
  if (!entry.payType && member?.payType && member.rateCents !== null) {
    entry.payType = member.payType
    entry.rateCents = member.rateCents
  }
  if (entry.payType === 'day' && entry.rateCents !== null) entry.costCents = entry.rateCents
  else if (entry.payType === 'hourly' && entry.rateCents !== null && entry.hours !== null) entry.costCents = Math.round(entry.hours * entry.rateCents)

  if (!entry.needsReview && entry.costCents === null) {
    entry.needsReview = true
    entry.problem = entry.payType === 'hourly' && entry.hours === null ? `no hours for ${entry.name}` : `no pay for ${entry.name}`
  }
  return entry
}

export function parseCrewReply(text: string, crew: CrewPick[]): ParsedReply {
  const t = text.trim()
  if (!t) return { kind: 'unreadable' }
  if (FIX.test(t)) return { kind: 'fix' }
  if (NONE.test(t)) return { kind: 'none' }
  if (SAME.test(t)) return { kind: 'same' }
  const segments = t
    .split(/[,\n;]+|\s+and\s+|\s*&\s*|\s+\+\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
  const entries = segments.map((s) => parseSegment(s, crew)).filter((e): e is ParsedEntry => e !== null)
  return entries.length ? { kind: 'entries', entries } : { kind: 'unreadable' }
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

/** "Tommy 8h, Gary $250 day, Lenny 6h at $30/hr" for the confirmation text. */
export function describeEntries(entries: Pick<ParsedEntry, 'name' | 'hours' | 'payType' | 'rateCents'>[]) {
  return entries
    .map((e) => {
      const parts = [e.name]
      if (e.hours !== null) parts.push(`${e.hours}h`)
      if (e.payType === 'day' && e.rateCents !== null) parts.push(`${usd(e.rateCents)} day`)
      if (e.payType === 'hourly' && e.rateCents !== null) parts.push(`at ${usd(e.rateCents)}/hr`)
      return parts.join(' ')
    })
    .join(', ')
}
