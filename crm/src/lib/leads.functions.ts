import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { asc, desc, eq } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { type PipelineStage, leads, user } from '#/db/schema'
import { requireAdmin, requireStaff } from '#/lib/guards'
import { record, requiredId } from '#/lib/input'
import {
  type LeadEdits,
  addActivity,
  assignLeadTo,
  setLeadDoNotContact,
  createLeadRecord,
  deleteLeadRecordingFiles,
  getLeadDetail,
  leadNotFound,
  moveLeadToStage,
  updateLeadRecord,
} from '#/lib/leads.server'
import type { CallDirection, ManualActivityKind } from '#/lib/pipeline'

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
  .handler(({ data, context: { staff } }) => createLeadRecord(getDb(env.DB), data, staff.id))

/** Moves a Lead to another Pipeline stage. Last write wins. Won also gives it a Customer and a Job. */
export const moveLeadStage = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  // Validators run before middleware: never throw here, so an unauthenticated caller always gets 401 first.
  .validator((data: { leadId: string; stage: PipelineStage }) => record(data))
  .handler(({ data, context: { staff } }) => moveLeadToStage(env.DB, requiredId(data.leadId), data.stage as PipelineStage, staff.id))

export type { LeadEdits }

/** Saves Lead detail edits. Last write wins; returns the new updated_at for the page to show. */
export const updateLead = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { leadId: string } & LeadEdits) => record(data))
  .handler(({ data }) => {
    const { leadId, ...edits } = data
    return updateLeadRecord(getDb(env.DB), requiredId(leadId), edits)
  })

/** One Lead with its activity (notes, calls, emails, texts, Form submissions), newest first. */
export const getLead = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { leadId: string }) => record(data))
  .handler(({ data }) => getLeadDetail(getDb(env.DB), requiredId(data.leadId)))

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
  .handler(({ data, context: { staff } }) => addActivity(getDb(env.DB), data, staff.id))

/** Staff a Lead can be assigned to (not banned), for the assignee picker. Names only. */
export const listAssignableStaff = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(() =>
    getDb(env.DB).select({ id: user.id, name: user.name }).from(user).where(eq(user.banned, false)).orderBy(asc(user.name)),
  )

/** Assigns a Lead to a Staff member, or unassigns it (`staffId: null`). */
export const setDoNotContact = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { leadId: string; value: boolean }) => record(data))
  .handler(({ data }) => setLeadDoNotContact(getDb(env.DB), requiredId(data.leadId), data.value))

export const assignLead = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { leadId: string; staffId: string | null }) => record(data))
  .handler(({ data }) => {
    const staffId = data.staffId === null || data.staffId === undefined ? null : requiredId(data.staffId)
    return assignLeadTo(getDb(env.DB), requiredId(data.leadId), staffId)
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
