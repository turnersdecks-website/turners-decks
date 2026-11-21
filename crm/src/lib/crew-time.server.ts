import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { getDb } from '#/db/client'
import { CREW_PAY_TYPES, type CrewPayType, companySettings, crewCheckins, crewMembers, crewTime, jobs, qboTransactions } from '#/db/schema'
import { type CrewPick, type ParsedEntry, describeEntries, matchCrew, parseCrewReply } from '#/lib/crew-reply'
import { badRequest } from '#/lib/input'
import { type OutboxEnv, enqueueJob, kickJobs } from '#/lib/outbox'

// Crew time (GLOSSARY Crew time). At the check-in hour (Settings, 6 PM by default, company time zone) the CRM texts Pat
// once per Job at the Build step: who worked today and how many hours. His reply (to the Quo number, from his cell in
// Settings > Texting) is read by crew-reply.ts into crew time rows on that Job, priced with the pay he gave or each
// person's usual pay, and the CRM texts back what it recorded. With two Jobs, the texts are numbered and his replies
// answer them in order (or he starts a reply with the Job's name). FIX undoes the last reply. A name not on the crew
// list, or someone with no pay, is kept and flagged on the Job page for Kristin, never guessed.
// The Job's labor hours and labor cost are the totals of its crew time once it has any (Job page > Numbers).
// Off until switched on in Settings > Company > Crew. Texts to Pat's own phone need no consent; they still go
// through the outbox and the "Texting is on" switch.

type Db = ReturnType<typeof getDb>

const OPEN_FOR_MS = 36 * 60 * 60_000
const ACTIVE_JOB = notInArray(jobs.status, ['done', 'cancelled', 'on_hold'])

/** "YYYY-MM-DD" and the hour, in the company time zone. */
export function localDay(now: number, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  )
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }
}

const shortDay = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`)
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

// ---------------------------------------------------------------------------
// Crew list and settings

export type CrewRowInput = { id?: string; name: string; aliases?: string; payType?: CrewPayType | null; rate?: number | null; active?: boolean }

export async function readCrewSettings(db: Db) {
  const [s, crew] = await Promise.all([
    db.select({ enabled: companySettings.crewCheckinEnabled, hour: companySettings.crewCheckinHour }).from(companySettings).where(eq(companySettings.id, 1)).get(),
    db.select().from(crewMembers).orderBy(desc(crewMembers.active), asc(crewMembers.name)),
  ])
  return { enabled: s?.enabled ?? false, hour: s?.hour ?? 18, crew }
}

/** Saves the crew list (rows without an id are added; nobody is deleted, only made inactive) and the check-in switch. */
export async function saveCrewSettings(db: Db, data: { enabled: unknown; hour: unknown; crew: unknown }) {
  if (typeof data.enabled !== 'boolean') throw badRequest('The check-in switch must be on or off.')
  const hour = Number(data.hour)
  if (!Number.isInteger(hour) || hour < 12 || hour > 21) throw badRequest('The check-in time must be between noon and 9 PM.')
  if (!Array.isArray(data.crew) || data.crew.length > 50) throw badRequest('The crew list is not valid.')
  const now = new Date()
  const writes: BatchItem<'sqlite'>[] = [db.update(companySettings).set({ crewCheckinEnabled: data.enabled, crewCheckinHour: hour }).where(eq(companySettings.id, 1))]
  for (const raw of data.crew as CrewRowInput[]) {
    const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, 60) : ''
    if (!name) continue
    const payType = raw.payType && (CREW_PAY_TYPES as readonly string[]).includes(raw.payType) ? raw.payType : null
    const rate = raw.rate === null || raw.rate === undefined || (raw.rate as unknown) === '' ? null : Number(raw.rate)
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 5000)) throw badRequest(`${name}'s pay must be a dollar amount.`)
    const values = {
      name,
      aliases: typeof raw.aliases === 'string' && raw.aliases.trim() ? raw.aliases.trim().slice(0, 200) : null,
      payType,
      rateCents: rate === null ? null : Math.round(rate * 100),
      active: raw.active !== false,
      updatedAt: now,
    }
    writes.push(
      raw.id ? db.update(crewMembers).set(values).where(eq(crewMembers.id, raw.id)) : db.insert(crewMembers).values({ id: crypto.randomUUID(), ...values, createdAt: now }),
    )
  }
  await db.batch(writes as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  return readCrewSettings(db)
}

const activeCrew = (db: Db): Promise<CrewPick[]> =>
  db
    .select({ id: crewMembers.id, name: crewMembers.name, aliases: crewMembers.aliases, payType: crewMembers.payType, rateCents: crewMembers.rateCents })
    .from(crewMembers)
    .where(eq(crewMembers.active, true))

// ---------------------------------------------------------------------------
// The daily check-in text

/** The check-in text for one Job. `n` and `of` number it when more than one Job is being built that day. */
export function checkinText(jobName: string, crewNames: string[], n = 1, of = 1) {
  const [a, b] = [...crewNames, 'Tommy', 'Gary'].filter((v, i, all) => all.indexOf(v) === i)
  const tag = of > 1 ? ` (${n} of ${of})` : ''
  return `${jobName}${tag}: who worked today and how many hours? Reply like: ${a} 8, ${b} 8. Add $ for a day amount (${b} $250) or a rate (${a} 6 at $30). Reply NONE if nobody worked.`
}

/** Cron (every 5 minutes): at or after the check-in hour, one text per Job at the Build step that has none today. */
export async function sendDueCheckins(env: OutboxEnv, now = Date.now()) {
  const db = getDb(env.DB)
  const s = await db
    .select({ on: companySettings.crewCheckinEnabled, hour: companySettings.crewCheckinHour, texting: companySettings.textingEnabled, to: companySettings.ownerMobile, tz: companySettings.timezone })
    .from(companySettings)
    .where(eq(companySettings.id, 1))
    .get()
  if (!s?.on || !s.texting || !s.to) return { sent: 0 }
  const { date, hour } = localDay(now, s.tz)
  if (hour < s.hour || hour >= 23) return { sent: 0 }
  const building = await db
    .select({ id: jobs.id, name: jobs.name })
    .from(jobs)
    .where(and(eq(jobs.step, 'build'), ACTIVE_JOB))
    .orderBy(asc(jobs.name))
  if (!building.length) return { sent: 0 }
  const done = new Set(
    (await db.select({ jobId: crewCheckins.jobId }).from(crewCheckins).where(and(eq(crewCheckins.workDate, date), inArray(crewCheckins.jobId, building.map((j) => j.id))))).map(
      (r) => r.jobId,
    ),
  )
  const crewNames = (await activeCrew(db)).map((c) => c.name.split(/\s+/)[0])
  const due = building.filter((j) => !done.has(j.id))
  const jobIds: string[] = []
  const writes: BatchItem<'sqlite'>[] = []
  due.forEach((j, i) => {
    writes.push(
      db
        .insert(crewCheckins)
        .values({ id: crypto.randomUUID(), jobId: j.id, workDate: date, status: 'sent', sentAt: new Date(now + i) })
        .onConflictDoNothing(),
    )
    const job = enqueueJob(db, {
      kind: 'sms_owner',
      dedupeKey: `crew_checkin:${j.id}:${date}`,
      payload: { to: s.to, content: checkinText(j.name, crewNames, building.length - due.length + i + 1, building.length) },
      envelope: { to: [s.to!], subject: 'Text: crew check-in' },
    })
    writes.push(job.insert)
    jobIds.push(job.id)
  })
  if (!writes.length) return { sent: 0 }
  await db.batch(writes as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  kickJobs(env, jobIds)
  return { sent: due.length }
}

// ---------------------------------------------------------------------------
// Pat's reply (quo-webhook.ts calls this for a text from his cell)

/** Recomputes the Job's labor hours and cost from its crew time (left alone while it has none). */
export function syncJobLabor(db: Db, jobId: string) {
  return db
    .update(jobs)
    .set({
      actualLaborHours: sql`(SELECT sum(${crewTime.hours}) FROM ${crewTime} WHERE ${crewTime.jobId} = ${jobId})`,
      laborCostCents: sql`(SELECT sum(${crewTime.costCents}) FROM ${crewTime} WHERE ${crewTime.jobId} = ${jobId})`,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), sql`EXISTS (SELECT 1 FROM ${crewTime} WHERE ${crewTime.jobId} = ${jobId})`))
}

function insertEntries(db: Db, jobId: string, workDate: string, checkinId: string | null, entries: ParsedEntry[], source: 'text' | 'manual', by: string | null) {
  return entries.map((e) =>
    db.insert(crewTime).values({
      id: crypto.randomUUID(),
      jobId,
      checkinId,
      crewMemberId: e.crewMemberId,
      name: e.name,
      workDate,
      hours: e.hours,
      payType: e.payType,
      rateCents: e.rateCents,
      costCents: e.costCents,
      needsReview: e.needsReview,
      source,
      createdBy: by,
    }),
  )
}

/**
 * The writes (and the texts back to Pat) for a text from Pat's cell. Returns null when no check-in is waiting and the
 * text is not FIX: then it is not a crew reply and the caller leaves it alone (it never becomes a Lead either way).
 */
export async function crewReplyWrites(db: Db, text: string, to: string, now: number, jobIds: string[]): Promise<BatchItem<'sqlite'>[] | null> {
  const crew = await activeCrew(db)
  const parsed = parseCrewReply(text, crew)
  const writes: BatchItem<'sqlite'>[] = []
  const say = (content: string, key: string) => {
    const job = enqueueJob(db, { kind: 'sms_owner', dedupeKey: `crew_reply:${key}`, payload: { to, content }, envelope: { to: [to], subject: 'Text: crew check-in reply' } })
    writes.push(job.insert)
    jobIds.push(job.id)
  }
  const since = new Date(now - OPEN_FOR_MS)

  if (parsed.kind === 'fix') {
    const last = await db
      .select({ id: crewCheckins.id, jobId: crewCheckins.jobId, workDate: crewCheckins.workDate, name: jobs.name })
      .from(crewCheckins)
      .innerJoin(jobs, eq(jobs.id, crewCheckins.jobId))
      .where(and(eq(crewCheckins.status, 'answered'), gte(crewCheckins.answeredAt, since)))
      .orderBy(desc(crewCheckins.answeredAt))
      .get()
    if (!last) return null
    writes.push(
      db.delete(crewTime).where(eq(crewTime.checkinId, last.id)),
      db.update(crewCheckins).set({ status: 'sent', answeredAt: null, reply: null, sentAt: new Date(now) }).where(eq(crewCheckins.id, last.id)),
      db
        .update(jobs)
        .set({
          actualLaborHours: sql`(SELECT sum(${crewTime.hours}) FROM ${crewTime} WHERE ${crewTime.jobId} = ${last.jobId})`,
          laborCostCents: sql`(SELECT sum(${crewTime.costCents}) FROM ${crewTime} WHERE ${crewTime.jobId} = ${last.jobId})`,
          updatedAt: new Date(now),
        })
        .where(eq(jobs.id, last.jobId)),
    )
    say(`OK, I cleared ${last.name} for ${shortDay(last.workDate)}. Send who worked and the hours again.`, `fix:${last.id}:${now}`)
    return writes
  }

  const open = await db
    .select({ id: crewCheckins.id, jobId: crewCheckins.jobId, workDate: crewCheckins.workDate, name: jobs.name })
    .from(crewCheckins)
    .innerJoin(jobs, eq(jobs.id, crewCheckins.jobId))
    .where(and(eq(crewCheckins.status, 'sent'), gte(crewCheckins.sentAt, since)))
    .orderBy(asc(crewCheckins.sentAt))
  if (!open.length) return null

  // A reply that starts with a Job's name ("Kondracki: Tommy 8") answers that one; otherwise the oldest waiting.
  let body = text
  let target = open[0]
  const lead = text.match(/^\s*([A-Za-z][A-Za-z' -]{1,40}?)\s*:\s*/)
  if (lead) {
    const hit = open.find((o) => o.name.toLowerCase().includes(lead[1].trim().toLowerCase()))
    if (hit) {
      target = hit
      body = text.slice(lead[0].length)
    }
  }
  const reply = lead && body !== text ? parseCrewReply(body, crew) : parsed
  const rest = open.filter((o) => o.id !== target.id)
  const next = rest.length ? ` Next: ${rest[0].name}, who worked and how many hours?` : ''
  const day = shortDay(target.workDate)
  const answered = db.update(crewCheckins).set({ status: 'answered', answeredAt: new Date(now), reply: text.slice(0, 1000) }).where(eq(crewCheckins.id, target.id))

  if (reply.kind === 'unreadable' || reply.kind === 'fix') {
    say(`Sorry, I couldn't read that for ${target.name}. Reply like: Tommy 8, Gary 8. Or NONE if nobody worked.`, `unread:${target.id}:${now}`)
    return writes
  }
  if (reply.kind === 'none') {
    writes.push(answered)
    say(`Got it: nobody worked on ${target.name} ${day}.${next}`, `none:${target.id}`)
    return writes
  }
  let entries: ParsedEntry[]
  if (reply.kind === 'same') {
    const prevDay = await db
      .select({ d: crewTime.workDate })
      .from(crewTime)
      .where(and(eq(crewTime.jobId, target.jobId), lt(crewTime.workDate, target.workDate)))
      .orderBy(desc(crewTime.workDate))
      .get()
    if (!prevDay) {
      say(`I don't have an earlier day for ${target.name}. Reply with names and hours, like: Tommy 8, Gary 8.`, `same-none:${target.id}:${now}`)
      return writes
    }
    const prev = await db.select().from(crewTime).where(and(eq(crewTime.jobId, target.jobId), eq(crewTime.workDate, prevDay.d)))
    entries = prev.map((p) => ({
      name: p.name,
      crewMemberId: p.crewMemberId,
      hours: p.hours,
      payType: p.payType,
      rateCents: p.rateCents,
      costCents: p.costCents,
      needsReview: p.needsReview,
    }))
  } else {
    entries = reply.entries
  }
  writes.push(answered, ...insertEntries(db, target.jobId, target.workDate, target.id, entries, 'text', null), syncJobLabor(db, target.jobId))
  const flagged = entries.filter((e) => e.needsReview)
  const check = flagged.length ? ` Kristin will check: ${flagged.map((e) => e.problem ?? e.name).join('; ')}.` : ''
  say(`Got it for ${target.name}, ${day}: ${describeEntries(entries)}.${check} Reply FIX if that's wrong.${next}`, `ok:${target.id}`)
  return writes
}

// ---------------------------------------------------------------------------
// Job page: crew time by hand

export async function listJobCrewTime(db: Db, jobId: string) {
  const [rows, crew] = await Promise.all([
    db
      .select({
        row: crewTime,
        txnDate: qboTransactions.txnDate,
        txnParty: qboTransactions.partyName,
        txnMemo: qboTransactions.memo,
        txnAmountCents: qboTransactions.amountCents,
      })
      .from(crewTime)
      .leftJoin(qboTransactions, eq(qboTransactions.id, crewTime.qboTxnId))
      .where(eq(crewTime.jobId, jobId))
      .orderBy(desc(crewTime.workDate), asc(crewTime.createdAt)),
    db.select({ id: crewMembers.id, name: crewMembers.name, payType: crewMembers.payType, rateCents: crewMembers.rateCents }).from(crewMembers).where(eq(crewMembers.active, true)).orderBy(asc(crewMembers.name)),
  ])
  const list = rows.map(({ row, ...t }) => ({ ...row, qboTxn: row.qboTxnId ? { date: t.txnDate, party: t.txnParty ?? t.txnMemo, amountCents: t.txnAmountCents } : null }))
  const sum = (f: (r: (typeof list)[number]) => boolean) => list.filter(f).reduce((a, r) => a + (r.costCents ?? 0), 0)
  const totals = {
    hours: list.reduce((a, r) => a + (r.hours ?? 0), 0),
    costCents: sum(() => true),
    /** Covered by QuickBooks payments: already in the Job's QuickBooks costs. */
    qboCents: sum((r) => r.paidVia === 'qbo'),
    /** Paid outside QuickBooks: added to the Job's costs (P&L) once. */
    outsideCents: sum((r) => r.paidVia === 'outside'),
    /** Not verified yet: not in any cost total until it is. */
    unverifiedCents: sum((r) => !r.paidVia),
  }
  return { rows: list, crew, totals, needsReview: list.filter((r) => r.needsReview).length, unverified: list.filter((r) => !r.paidVia).length }
}

// ---------------------------------------------------------------------------
// Verifying crew pay (counted once): link an entry to the QuickBooks payment that covered it, or mark it paid outside
// QuickBooks. A QuickBooks payment still in To sort is sorted onto the Job when linked.

const dayShift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** QuickBooks costs that could be this crew member's pay: on this Job or not sorted yet, from a week before the work
 * day to three weeks after, with the ones that mention the person's name first. */
export async function crewPayCandidates(db: Db, crewTimeId: string) {
  const entry = await db.select().from(crewTime).where(eq(crewTime.id, crewTimeId)).get()
  if (!entry) throw badRequest('That entry is gone.')
  const txns = await db
    .select()
    .from(qboTransactions)
    .where(
      and(
        eq(qboTransactions.deleted, false),
        eq(qboTransactions.kind, 'cost'),
        or(eq(qboTransactions.jobId, entry.jobId), isNull(qboTransactions.assignment)),
        gte(qboTransactions.txnDate, dayShift(entry.workDate, -7)),
        lte(qboTransactions.txnDate, dayShift(entry.workDate, 21)),
      ),
    )
    .orderBy(asc(qboTransactions.txnDate))
    .limit(200)
  const first = entry.name.split(/\s+/)[0].toLowerCase()
  const mentions = (t: (typeof txns)[number]) => [t.partyName, t.memo, t.linesJson].some((v) => v?.toLowerCase().includes(first))
  const linked = txns.length
    ? await db
        .select({ txn: crewTime.qboTxnId, n: sql<number>`count(*)`, cents: sql<number>`coalesce(sum(${crewTime.costCents}), 0)` })
        .from(crewTime)
        .where(inArray(crewTime.qboTxnId, txns.map((t) => t.id)))
        .groupBy(crewTime.qboTxnId)
    : []
  const byTxn = new Map(linked.map((l) => [l.txn, l]))
  const sameName = await db
    .select({ id: crewTime.id, workDate: crewTime.workDate, costCents: crewTime.costCents })
    .from(crewTime)
    .where(and(eq(crewTime.jobId, entry.jobId), eq(crewTime.name, entry.name), isNull(crewTime.paidVia)))
    .orderBy(asc(crewTime.workDate))
  return {
    entry: { id: entry.id, name: entry.name, workDate: entry.workDate, costCents: entry.costCents },
    /** This person's other unverified days on the Job: one payment often covers several (a weekend). */
    sameName,
    candidates: txns
      .map((t) => ({
        id: t.id,
        date: t.txnDate,
        party: t.partyName ?? t.memo ?? t.account ?? 'QuickBooks cost',
        account: t.account,
        amountCents: t.amountCents,
        onJob: t.jobId === entry.jobId,
        mentionsName: mentions(t),
        linkedCount: byTxn.get(t.id)?.n ?? 0,
        linkedCents: byTxn.get(t.id)?.cents ?? 0,
      }))
      .sort((a, b) => Number(b.mentionsName) - Number(a.mentionsName) || Number(b.onJob) - Number(a.onJob) || a.date.localeCompare(b.date))
      .slice(0, 15),
  }
}

export type VerifyCrewInput = { ids: string[]; via: 'qbo'; qboTxnId: string } | { ids: string[]; via: 'outside'; note: string }

export async function verifyCrewPay(db: Db, input: VerifyCrewInput, staffId: string | null, now = Date.now()) {
  const ids = Array.isArray(input.ids) ? input.ids.filter((v) => typeof v === 'string').slice(0, 50) : []
  if (!ids.length) throw badRequest('Pick at least one day.')
  const entries = await db.select({ id: crewTime.id, jobId: crewTime.jobId }).from(crewTime).where(inArray(crewTime.id, ids))
  if (entries.length !== ids.length) throw badRequest('Some of those entries are gone.')
  const jobId = entries[0].jobId
  if (entries.some((e) => e.jobId !== jobId)) throw badRequest('Those entries are on different Jobs.')
  const writes: BatchItem<'sqlite'>[] = []
  if (input.via === 'qbo') {
    const txn = await db.select().from(qboTransactions).where(eq(qboTransactions.id, String(input.qboTxnId))).get()
    if (!txn || txn.deleted) throw badRequest('That QuickBooks transaction is gone.')
    if (txn.assignment === 'job' && txn.jobId !== jobId) throw badRequest('That QuickBooks payment is on another Job.')
    if (txn.assignment === 'ignored') throw badRequest('That QuickBooks payment is marked Ignored. Sort it onto this Job first.')
    if (!txn.assignment)
      writes.push(db.update(qboTransactions).set({ assignment: 'job', jobId, assignedBy: staffId ?? 'auto', assignedAt: new Date(now) }).where(eq(qboTransactions.id, txn.id)))
    writes.push(db.update(crewTime).set({ paidVia: 'qbo', qboTxnId: txn.id, paidNote: null, verifiedAt: new Date(now), verifiedBy: staffId }).where(inArray(crewTime.id, ids)))
  } else {
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 100) : ''
    if (!note) throw badRequest('Say how they were paid, e.g. cash.')
    writes.push(db.update(crewTime).set({ paidVia: 'outside', qboTxnId: null, paidNote: note, verifiedAt: new Date(now), verifiedBy: staffId }).where(inArray(crewTime.id, ids)))
  }
  await db.batch(writes as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  return listJobCrewTime(db, jobId)
}

/** Back to not verified (the QuickBooks payment stays sorted on the Job). */
export async function unverifyCrewPay(db: Db, id: string) {
  const [row] = await db.update(crewTime).set({ paidVia: null, qboTxnId: null, paidNote: null, verifiedAt: null, verifiedBy: null }).where(eq(crewTime.id, id)).returning({ jobId: crewTime.jobId })
  if (!row) throw badRequest('That entry is gone.')
  return listJobCrewTime(db, row.jobId)
}

export type ManualCrewInput = { jobId: string; workDate: string; crewMemberId?: string | null; name?: string; hours?: number | null; payType?: CrewPayType | null; rate?: number | null }

export async function addCrewTime(db: Db, input: ManualCrewInput, staffId: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate ?? '')) throw badRequest('Pick the day they worked.')
  const job = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, input.jobId)).get()
  if (!job) throw badRequest('That Job no longer exists.')
  const crew = await activeCrew(db)
  const member = input.crewMemberId ? crew.find((c) => c.id === input.crewMemberId) ?? null : input.name ? matchCrew(input.name, crew) : null
  const name = member?.name ?? input.name?.trim().slice(0, 60)
  if (!name) throw badRequest('Pick who worked.')
  const hours = input.hours === null || input.hours === undefined || (input.hours as unknown) === '' ? null : Number(input.hours)
  if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 24)) throw badRequest('Hours must be between 0 and 24.')
  const given = input.rate === null || input.rate === undefined || (input.rate as unknown) === '' ? null : Math.round(Number(input.rate) * 100)
  if (given !== null && (!Number.isFinite(given) || given < 0)) throw badRequest('Pay must be a dollar amount.')
  const payType = given !== null ? (input.payType ?? 'hourly') : (member?.payType ?? null)
  const rateCents = given ?? member?.rateCents ?? null
  const costCents = payType === 'day' && rateCents !== null ? rateCents : payType === 'hourly' && rateCents !== null && hours !== null ? Math.round(hours * rateCents) : null
  const entry: ParsedEntry = { name, crewMemberId: member?.id ?? null, hours, payType, rateCents, costCents, needsReview: costCents === null || !member }
  await db.batch([...insertEntries(db, input.jobId, input.workDate, null, [entry], 'manual', staffId), syncJobLabor(db, input.jobId)] as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  return listJobCrewTime(db, input.jobId)
}

export async function removeCrewTime(db: Db, id: string) {
  const row = await db.select({ jobId: crewTime.jobId }).from(crewTime).where(eq(crewTime.id, id)).get()
  if (!row) throw badRequest('That entry is already gone.')
  const left = await db.select({ n: sql<number>`count(*)` }).from(crewTime).where(and(eq(crewTime.jobId, row.jobId), ne(crewTime.id, id))).get()
  await db.batch([
    db.delete(crewTime).where(eq(crewTime.id, id)),
    // The last entry gone: clear the totals it filled in, rather than leave them stale.
    left?.n
      ? syncJobLabor(db, row.jobId)
      : db.update(jobs).set({ actualLaborHours: null, laborCostCents: null, updatedAt: new Date() }).where(eq(jobs.id, row.jobId)),
  ] as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  return listJobCrewTime(db, row.jobId)
}

/** Marks an entry checked (the flag clears once Kristin has fixed the name or pay, or decided it is right). */
export async function clearCrewTimeReview(db: Db, id: string) {
  const [row] = await db.update(crewTime).set({ needsReview: false }).where(eq(crewTime.id, id)).returning({ jobId: crewTime.jobId })
  if (!row) throw badRequest('That entry is gone.')
  return listJobCrewTime(db, row.jobId)
}
