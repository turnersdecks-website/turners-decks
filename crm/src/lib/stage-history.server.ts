import { type SQL, sql } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { type PipelineStage, leadStageChanges, leads } from '#/db/schema'

// Stage history (lead_stage_changes). Every stage write puts one of these in its D1 batch:
// - a conditional stage UPDATE: `stageMove*` goes BEFORE the update with the update's exact WHERE. It inserts from the
//   Lead row as it stands, so it writes a row only when the update is about to change the stage (and never when the
//   Lead is already at the target stage), and from_stage is the stage being left.
// - a Lead INSERT: `leadCreated*` goes AFTER the insert. It writes the Lead's starting stage (from null, at
//   created_at) only when the Lead row exists and has no history yet, so an insert that did nothing writes nothing.

type Db = ReturnType<typeof getDb>
/** `id`: the stage history row's id, when a later statement in the batch needs to know whether it was written. */
export type StageChangeBy = { at: Date | number; by?: string | null; reason?: string | null; id?: string }

const ms = (at: Date | number) => (typeof at === 'number' ? at : at.getTime())

/** Drizzle form of a stage move: `where` is the stage UPDATE's WHERE on `leads`. */
export function stageMove(db: Db, to: PipelineStage, where: SQL, who: StageChangeBy) {
  // Columns in table order: id, lead_id, from_stage, to_stage, changed_at, changed_by, reason.
  return db.insert(leadStageChanges).select(sql`
    SELECT ${crypto.randomUUID()}, ${leads.id}, ${leads.stage}, ${to}, ${ms(who.at)}, ${who.by ?? null}, ${who.reason ?? null}
    FROM ${leads} WHERE (${where}) AND ${leads.stage} <> ${to}`)
}

/** D1 form of a stage move: `where` is the UPDATE's WHERE on `leads` with anonymous `?` placeholders. */
export function stageMoveD1(d1: D1Database, to: PipelineStage, where: string, params: unknown[], who: StageChangeBy) {
  return d1
    .prepare(
      `INSERT INTO lead_stage_changes (id, lead_id, from_stage, to_stage, changed_at, changed_by, reason)
       SELECT ?, id, stage, ?, ?, ?, ? FROM leads WHERE (${where}) AND stage <> ?`,
    )
    .bind(who.id ?? crypto.randomUUID(), to, ms(who.at), who.by ?? null, who.reason ?? null, ...params, to)
}

const CREATED = `INSERT INTO lead_stage_changes (id, lead_id, from_stage, to_stage, changed_at, changed_by, reason)
  SELECT ?, id, NULL, stage, created_at, ?, ? FROM leads
  WHERE id = ? AND NOT EXISTS (SELECT 1 FROM lead_stage_changes c WHERE c.lead_id = leads.id)`

/** Drizzle form: the starting stage of a Lead just inserted in this batch. */
export function leadCreated(db: Db, leadId: string, who: { by?: string | null; reason?: string | null } = {}) {
  return db.insert(leadStageChanges).select(sql`
    SELECT ${crypto.randomUUID()}, ${leads.id}, NULL, ${leads.stage}, ${leads.createdAt}, ${who.by ?? null}, ${who.reason ?? null} FROM ${leads}
    WHERE ${leads.id} = ${leadId} AND NOT EXISTS (SELECT 1 FROM lead_stage_changes c WHERE c.lead_id = ${leads.id})`)
}

/** D1 form of leadCreated. */
export function leadCreatedD1(d1: D1Database, leadId: string, who: { by?: string | null; reason?: string | null } = {}) {
  return d1.prepare(CREATED).bind(crypto.randomUUID(), who.by ?? null, who.reason ?? null, leadId)
}
