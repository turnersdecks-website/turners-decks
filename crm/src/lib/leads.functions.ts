import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { addressKey } from '#/lib/address-key'
import { PIPELINE_STAGES, type PipelineStage, leadActivity, leadStageChanges, leads, user } from '#/db/schema'
import { requireAdmin, requireStaff } from '#/lib/guards'
import { badRequest, optionalText, optionalTime, record, requiredId } from '#/lib/input'
import { FIRST_CONTACT_FIELDS, LEAD_SOURCE_MANUAL, deleteLeadRecordingFiles, leadFields, leadNotFound, optionalCount, refuseClash } from '#/lib/leads.server'
import { leadCreated, stageMove } from '#/lib/stage-history.server'
import { CALL_DIRECTIONS, type CallDirection, MANUAL_ACTIVITY_KINDS, type ManualActivityKind } from '#/lib/pipeline'

export const listLeads = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async () => {
    return getDb(env.DB)
      .select({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        email: leads.email,
        phoneE164: leads.phoneE164,
        stage: leads.stage,
        source: leads.source,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .orderBy(desc(leads.createdAt))
      .limit(200)
  })

/** Every Lead for the Pipeline board (newest first) with its assignee's name. */
export const listPipeline = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(() =>
    getDb(env.DB)
      .select({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        email: leads.email,
        phone: leads.phone,
        street: leads.street,
        city: leads.city,
        stage: leads.stage,
        source: leads.source,
        serviceType: leads.serviceType,
        needsReview: leads.needsReview,
        assigneeName: user.name,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .leftJoin(user, eq(user.id, leads.assignedTo))
      .orderBy(desc(leads.createdAt))
      .limit(2000),
  )

/** A Lead added by hand on the board: stage new, Source and first Source `manual`. */
export const createLead = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: LeadEdits) => record(data))
  .handler(async ({ data, context: { staff } }) => {
    const fields = leadFields(data)
    const db = getDb(env.DB)
    await refuseClash(db, fields)
    const now = new Date()
    const id = crypto.randomUUID()
    await db.batch([
      db.insert(leads).values({
        id,
        ...fields,
        stage: 'new',
        source: LEAD_SOURCE_MANUAL,
        firstSource: LEAD_SOURCE_MANUAL,
        createdAt: now,
        updatedAt: now,
      }),
      leadCreated(db, id, { by: staff.id, reason: 'Added by hand' }),
    ])
    return { id }
  })

/** Moves a Lead to another Pipeline stage. Last write wins. */
export const moveLeadStage = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  // Validators run before middleware: never throw here, so an unauthenticated caller always gets 401 first.
  .validator((data: { leadId: string; stage: PipelineStage }) => record(data))
  .handler(async ({ data, context: { staff } }) => {
    const leadId = requiredId(data.leadId)
    const stage = data.stage as PipelineStage
    if (!PIPELINE_STAGES.includes(stage)) throw badRequest('Unknown Pipeline stage.')
    const db = getDb(env.DB)
    const now = new Date()
    const where = eq(leads.id, leadId)
    const [, moved] = await db.batch([
      stageMove(db, stage, where, { at: now, by: staff.id }),
      db.update(leads).set({ stage, updatedAt: now }).where(where).returning({ id: leads.id, stage: leads.stage, updatedAt: leads.updatedAt }),
    ])
    if (!moved.length) throw leadNotFound()
    return moved[0]
  })

/** What Staff may edit on a Lead. Everything else (stage, assignment, notes) has its own server function. */
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
}

/** Saves Lead detail edits. Last write wins; returns the new updated_at for the page to show. */
export const updateLead = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { leadId: string } & LeadEdits) => record(data))
  .handler(async ({ data }) => {
    const leadId = requiredId(data.leadId)
    if (FIRST_CONTACT_FIELDS.some((k) => k in data)) {
      throw badRequest('Source, first source, first touch and created time cannot be changed.')
    }
    const fields = leadFields(data)
    const db = getDb(env.DB)
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
      const update = db
        .update(leads)
        .set({
          ...fields,
          updatedAt: now,
          ...(houseChanged ? { activeLeak: false, roofAnswersVersion: sql`${leads.roofAnswersVersion} + 1` } : {}),
        })
        .where(and(eq(leads.id, leadId), ...unchangedSinceRead))
        .returning({ id: leads.id, updatedAt: leads.updatedAt })
      const saved = await update
      if (saved.length) return saved[0]
    }
    throw new Response('The Lead was changed by someone else at the same time. Reload and try again.', { status: 409 })
  })

const ADDRESS_FIELDS = ['street', 'city', 'state', 'zip'] as const

/** One Lead with its activity (notes, calls, emails, texts, Form submissions), newest first. */
export const getLead = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { leadId: string }) => record(data))
  .handler(async ({ data }) => {
    const leadId = requiredId(data.leadId)
    const db = getDb(env.DB)
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
    return { lead, activity, stageHistory }
  })

export type NewActivity = {
  leadId: string
  kind: ManualActivityKind
  body?: string
  direction?: CallDirection
  outcome?: string
  durationMin?: number | null
  /** Follow-up due time, epoch ms. */
  followUpAt?: number | null
}

/** Adds a note (or a logged call/email/text) to a Lead, optionally with a Follow-up date. */
export const addLeadActivity = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: NewActivity) => record(data))
  .handler(async ({ data, context: { staff } }) => {
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

    const db = getDb(env.DB)
    const lead = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).get()
    if (!lead) throw leadNotFound()
    const id = crypto.randomUUID()
    const now = new Date()
    const insert = db.insert(leadActivity).values({
      id,
      leadId,
      kind,
      direction: direction as string | null,
      outcome,
      durationMin,
      body,
      authorId: staff.id,
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
        stageMove(db, 'contacted', isNew, { at: now, by: staff.id, reason }),
        db.update(leads).set({ stage: 'contacted', updatedAt: now }).where(isNew),
      ])
    }
    return { id }
  })

/** Staff a Lead can be assigned to (not banned), for the assignee picker. Names only. */
export const listAssignableStaff = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(() =>
    getDb(env.DB).select({ id: user.id, name: user.name }).from(user).where(eq(user.banned, false)).orderBy(asc(user.name)),
  )

/** Assigns a Lead to a Staff member, or unassigns it (`staffId: null`). */
export const assignLead = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { leadId: string; staffId: string | null }) => record(data))
  .handler(async ({ data }) => {
    const leadId = requiredId(data.leadId)
    const staffId = data.staffId === null || data.staffId === undefined ? null : requiredId(data.staffId)
    const db = getDb(env.DB)
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
  })

/**
 * Deletes a Lead (admins only, plan 006 decision 9). D1 cascades remove its activity, stage history and Quote file
 * rows. The Lead's
 * R2 prefix is recorded in the same batch and the `r2-cleanup` cron deletes its Quote files (plan 009 decision 15).
 */
export const deleteLead = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { leadId: string }) => record(data))
  .handler(async ({ data }) => {
    if (!(await deleteLeadRecordingFiles(env.DB, requiredId(data.leadId)))) throw leadNotFound()
    return { ok: true }
  })
