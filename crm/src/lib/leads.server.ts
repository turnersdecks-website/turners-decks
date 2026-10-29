import { and, desc, eq, inArray, isNotNull, isNull, like, ne, or, sql } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { PIPELINE_STAGES, type PipelineStage, customers, leadActivity, leadStageChanges, leads, user } from '#/db/schema'
import { addressKey } from '#/lib/address-key'
import { customerIdFor, wonWrites } from '#/lib/customers.server'
import { badRequest, optionalText, optionalTime, requiredId } from '#/lib/input'
import { toE164, validEmail } from '#/lib/intake'
import { CALL_DIRECTIONS, MANUAL_ACTIVITY_KINDS, type ManualActivityKind } from '#/lib/pipeline'
import { leadCreated, stageMove, stageMoveD1 } from '#/lib/stage-history.server'

// Server-only helpers for leads.functions.ts. Kept out of that module so its client build (handlers stripped)
// does not keep the schema import alive. The Lead operations below are shared by the CRM's server functions
// (leads.functions.ts) and the MCP tools (src/mcp/): each takes the database, the input and the acting Staff id.

type Db = ReturnType<typeof getDb>

export const leadNotFound = () => new Response('Lead not found', { status: 404 })

// GLOSSARY Source: manual entry.
export const LEAD_SOURCE_MANUAL = 'manual'

// PLAN.md > Data model: these never change after insert. A write that names one is refused, not ignored.
export const FIRST_CONTACT_FIELDS = ['source', 'firstSource', 'firstTouchJson', 'createdAt'] as const

/** 409 if another Lead already has this phone or email (they are unique; Intake dedupes on them). */
export async function refuseClash(db: Db, f: { phoneE164: string | null; emailLower: string | null }, exceptId?: string) {
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
    preferredMaterial: optionalText(data.preferredMaterial, 100),
    timeframe: optionalText(data.timeframe, 100),
  }
}

// Import dates (build 1, 2026-10-28): history brought in from email and the project folders keeps when it happened.
// Only admins may set them (the callers check); a date in the future, or before the business, is refused.
const EARLIEST_IMPORT = Date.UTC(2015, 0, 1)

/** An import date (epoch ms) or null; 400 when it is in the future or implausibly old. */
export function importedAt(value: unknown, label: string): number | null {
  const ms = optionalTime(value)
  if (ms === null) return null
  if (ms > Date.now() + 60_000 || ms < EARLIEST_IMPORT) throw badRequest(`${label} must be a past date (2015 or later).`)
  return ms
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

// ---------------------------------------------------------------------------
// Lead operations (moved out of leads.functions.ts handlers so the MCP tools run the same code).

/** What Staff may edit on a Lead. Everything else (stage, assignment, notes) has its own operation. */
export type LeadEdits = {
  firstName: string
  lastName: string
  email: string
  phone: string
  street: string
  city: string
  state: string
  zip: string
  serviceType: string
  message: string
  preferredMaterial: string
  timeframe: string
}
export const LEAD_EDIT_KEYS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'street',
  'city',
  'state',
  'zip',
  'serviceType',
  'message',
  'preferredMaterial',
  'timeframe',
] as const

/**
 * A Lead added by hand: stage new, Source and first Source `manual`. Joins the Customer with its phone or email.
 * An import (admin) may say when it was received and where it came from (`website` for a past website form).
 */
export async function createLeadRecord(
  db: Db,
  data: Record<string, unknown>,
  staffId: string,
  imported: { receivedAt?: number | null; source?: string | null } = {},
) {
  const fields = leadFields(data)
  await refuseClash(db, fields)
  const customerId = await customerIdFor(db, fields)
  const now = new Date()
  const createdAt = imported.receivedAt ? new Date(imported.receivedAt) : now
  const source = imported.source ?? LEAD_SOURCE_MANUAL
  const id = crypto.randomUUID()
  await db.batch([
    db.insert(leads).values({
      id,
      ...fields,
      customerId,
      stage: 'new',
      source,
      firstSource: source,
      createdAt,
      updatedAt: now,
    }),
    leadCreated(db, id, { by: staffId, reason: imported.receivedAt ? 'Imported' : 'Added by hand' }),
  ])
  return { id }
}

/**
 * Moves a Lead to another Pipeline stage. Last write wins. Moving to won also gives the Lead its Customer and a Job
 * (customers.server.ts wonWrites), in the same batch.
 */
export async function moveLeadToStage(
  d1: D1Database,
  leadId: string,
  stage: PipelineStage,
  staffId: string | null,
  imported: { at?: number | null; reason?: string | null } = {},
) {
  if (!PIPELINE_STAGES.includes(stage)) throw badRequest('Unknown Pipeline stage.')
  const now = Date.now()
  // An import records when the move happened (stage history, and a won Lead's Customer since); updated_at is now.
  const at = imported.at ?? now
  const stageChangeId = crypto.randomUUID()
  const results = await d1.batch([
    stageMoveD1(d1, stage, 'id = ?', [leadId], { at, by: staffId, id: stageChangeId, reason: imported.reason ?? null }),
    d1.prepare('UPDATE leads SET stage = ?, updated_at = ? WHERE id = ? RETURNING id, stage, updated_at, customer_id').bind(stage, now, leadId),
    ...(stage === 'won' ? wonWrites(d1, leadId, stageChangeId, at) : []),
  ])
  const moved = results[1].results[0] as { id: string; stage: PipelineStage; updated_at: number } | undefined
  if (!moved) throw leadNotFound()
  const after =
    stage === 'won'
      ? await d1.prepare('SELECT customer_id FROM leads WHERE id = ?').bind(leadId).first<string | null>('customer_id')
      : null
  return { id: moved.id, stage: moved.stage, updatedAt: new Date(moved.updated_at), ...(stage === 'won' ? { customerId: after } : {}) }
}

/** Saves Lead detail edits (every LeadEdits field; missing ones are cleared). Last write wins. */
export async function updateLeadRecord(db: Db, leadId: string, data: Record<string, unknown>) {
  if (FIRST_CONTACT_FIELDS.some((k) => k in data)) {
    throw badRequest('Source, first source, first touch and created time cannot be changed.')
  }
  const fields = leadFields(data)
  await refuseClash(db, fields, leadId)
  // The write is fenced on the address read here, so "did the address change" is decided against what it
  // overwrites: when a concurrent edit changed the address in between, read again and decide again.
  for (let tries = 0; tries < 3; tries++) {
    const before = await db
      .select({ street: leads.street, city: leads.city, state: leads.state, zip: leads.zip })
      .from(leads)
      .where(eq(leads.id, leadId))
      .get()
    if (!before) throw leadNotFound()
    const now = new Date()
    const unchangedSinceRead = ADDRESS_FIELDS.map((k) => (before[k] === null ? isNull(leads[k]) : eq(leads[k], before[k])))
    // Plan 008 (Pine & Gable): a different house (address key, so "Avenue" -> "Ave" is the same one) starts with no
    // roof answers. Kept so the columns stay correct for when Estimates are ported. Computed from the stored parts.
    const houseChanged = addressKey({ street: before.street, zip: before.zip }) !== fields.addressKey
    const saved = await db
      .update(leads)
      .set({
        ...fields,
        updatedAt: now,
        ...(houseChanged ? { activeLeak: false, roofAnswersVersion: sql`${leads.roofAnswersVersion} + 1` } : {}),
      })
      .where(and(eq(leads.id, leadId), ...unchangedSinceRead))
      .returning({ id: leads.id, updatedAt: leads.updatedAt })
    if (saved.length) return saved[0]
  }
  throw new Response('The Lead was changed by someone else at the same time. Reload and try again.', { status: 409 })
}

const ADDRESS_FIELDS = ['street', 'city', 'state', 'zip'] as const

/** One Lead with its activity (newest first), stage history and Customer. */
export async function getLeadDetail(db: Db, leadId: string) {
  const [lead, activity, stageHistory] = await Promise.all([
    db.select().from(leads).where(eq(leads.id, leadId)).get(),
    db
      .select({
        id: leadActivity.id,
        kind: leadActivity.kind,
        direction: leadActivity.direction,
        outcome: leadActivity.outcome,
        durationMin: leadActivity.durationMin,
        body: leadActivity.body,
        authorName: user.name,
        followUpAt: leadActivity.followUpAt,
        followUpDoneAt: leadActivity.followUpDoneAt,
        dispatchState: leadActivity.dispatchState,
        providerMessageId: leadActivity.providerMessageId,
        createdAt: leadActivity.createdAt,
      })
      .from(leadActivity)
      .leftJoin(user, eq(user.id, leadActivity.authorId))
      .where(eq(leadActivity.leadId, leadId))
      .orderBy(desc(leadActivity.createdAt), desc(sql`${leadActivity}.rowid`))
      .limit(500),
    // Stage history, newest first (who moved it; null = automatic).
    db
      .select({
        id: leadStageChanges.id,
        fromStage: leadStageChanges.fromStage,
        toStage: leadStageChanges.toStage,
        changedAt: leadStageChanges.changedAt,
        changedByName: user.name,
      })
      .from(leadStageChanges)
      .leftJoin(user, eq(user.id, leadStageChanges.changedBy))
      .where(eq(leadStageChanges.leadId, leadId))
      .orderBy(desc(leadStageChanges.changedAt), desc(sql`${leadStageChanges}.rowid`))
      .limit(200),
  ])
  if (!lead) throw leadNotFound()
  const customer = lead.customerId
    ? ((await db.select({ id: customers.id, firstName: customers.firstName, lastName: customers.lastName }).from(customers).where(eq(customers.id, lead.customerId)).get()) ?? null)
    : null
  return { lead, activity, stageHistory, customer }
}

/**
 * Adds a note (or a logged call/email/text) to a Lead, optionally with a Follow-up date. An import (admin) may say
 * when it happened (`imported.at`); a logged contact then moves a new Lead to contacted as of that time.
 */
export async function addActivity(db: Db, data: Record<string, unknown>, staffId: string, imported: { at?: number | null } = {}) {
  const leadId = requiredId(data.leadId)
  const kind = data.kind as ManualActivityKind
  if (!MANUAL_ACTIVITY_KINDS.includes(kind)) throw badRequest('Staff can log a note, call, email or text.')
  const isCall = kind === 'call'
  const body = optionalText(data.body, 8000)
  const outcome = isCall ? optionalText(data.outcome, 100) : null
  const direction = isCall ? (data.direction ?? 'outbound') : null
  if (direction !== null && !CALL_DIRECTIONS.includes(direction as never)) throw badRequest('Call direction is inbound or outbound.')
  const durationMin = isCall ? optionalCount(data.durationMin) : null
  const followUpAt = optionalTime(data.followUpAt)
  if (!body && !outcome) throw badRequest('Add some details first.')

  const lead = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).get()
  if (!lead) throw leadNotFound()
  const id = crypto.randomUUID()
  const now = imported.at ? new Date(imported.at) : new Date()
  const insert = db.insert(leadActivity).values({
    id,
    leadId,
    kind,
    direction: direction as string | null,
    outcome,
    durationMin,
    body,
    authorId: staffId,
    followUpAt: followUpAt === null ? null : new Date(followUpAt),
    createdAt: now,
  })
  if (kind === 'note') {
    await insert
  } else {
    // Contact made: a new Lead becomes contacted. The stage guard sits in the UPDATE itself, so a concurrent
    // move to a later stage is never overwritten.
    const isNew = and(eq(leads.id, leadId), eq(leads.stage, 'new'))!
    const reason = `${kind[0].toUpperCase()}${kind.slice(1)} logged`
    await db.batch([
      insert,
      stageMove(db, 'contacted', isNew, { at: now, by: staffId, reason }),
      db.update(leads).set({ stage: 'contacted', updatedAt: new Date() }).where(isNew),
    ])
  }
  return { id }
}

/** Assigns a Lead to a Staff member, or unassigns it (`staffId: null`). */
export async function assignLeadTo(db: Db, leadId: string, staffId: string | null) {
  if (staffId) {
    const assignee = await db.select({ id: user.id }).from(user).where(and(eq(user.id, staffId), eq(user.banned, false))).get()
    if (!assignee) throw badRequest('That is not an active Staff member.')
  }
  const saved = await db
    .update(leads)
    .set({ assignedTo: staffId, updatedAt: new Date() })
    .where(eq(leads.id, leadId))
    .returning({ id: leads.id, assignedTo: leads.assignedTo, updatedAt: leads.updatedAt })
  if (!saved.length) throw leadNotFound()
  return saved[0]
}

/** Marks a Follow-up done (now) or reopens it. */
export async function setFollowUpDoneRecord(db: Db, activityId: string, done: boolean) {
  const updated = await db
    .update(leadActivity)
    .set({ followUpDoneAt: done ? new Date() : null })
    .where(and(eq(leadActivity.id, activityId), isNotNull(leadActivity.followUpAt)))
    .returning({ followUpDoneAt: leadActivity.followUpDoneAt })
  if (!updated.length) throw new Response('Follow-up not found', { status: 404 })
  return updated[0]
}

/** Leads for the MCP: newest first, optionally by stage and a name / phone / email / city search. */
export async function searchLeads(db: Db, opts: { stages?: PipelineStage[] | null; search?: string | null; limit?: number } = {}) {
  const q = opts.search?.trim()
  // LIKE wildcards in the search are dropped rather than escaped.
  const pattern = q ? `%${q.replace(/[%_\\]/g, '')}%` : null
  const digits = q?.replace(/\D/g, '')
  const stages = opts.stages?.filter((s) => PIPELINE_STAGES.includes(s))
  return db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      phone: leads.phone,
      city: leads.city,
      stage: leads.stage,
      source: leads.source,
      serviceType: leads.serviceType,
      assignedTo: leads.assignedTo,
      customerId: leads.customerId,
      needsReview: leads.needsReview,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(
      and(
        stages?.length ? inArray(leads.stage, stages) : undefined,
        pattern
          ? or(
              sql`(coalesce(${leads.firstName}, '') || ' ' || coalesce(${leads.lastName}, '')) LIKE ${pattern}`,
              like(leads.emailLower, pattern.toLowerCase()),
              like(leads.city, pattern),
              digits && digits.length >= 3 ? like(leads.phoneE164, `%${digits}%`) : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(desc(leads.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 500))
}

/** Open Follow-ups (not done), soonest first, with their Lead's name. `dueBefore` (epoch ms) limits to those due. */
export async function listOpenFollowUps(db: Db, opts: { dueBefore?: number | null; limit?: number } = {}) {
  return db
    .select({
      activityId: leadActivity.id,
      leadId: leadActivity.leadId,
      firstName: leads.firstName,
      lastName: leads.lastName,
      kind: leadActivity.kind,
      body: leadActivity.body,
      followUpAt: leadActivity.followUpAt,
    })
    .from(leadActivity)
    .innerJoin(leads, eq(leads.id, leadActivity.leadId))
    .where(
      and(
        isNotNull(leadActivity.followUpAt),
        isNull(leadActivity.followUpDoneAt),
        opts.dueBefore ? sql`${leadActivity.followUpAt} <= ${opts.dueBefore}` : undefined,
      ),
    )
    .orderBy(leadActivity.followUpAt)
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
}
