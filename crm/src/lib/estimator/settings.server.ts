// Server-only reads and writes of the Estimator settings draft and Published versions (FLW-200).
import { desc, eq } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { estimatorDraft, estimatorVersions } from '#/db/schema'
import type { EstimatorDocument, FieldErrors } from './document'
import { validateSettings } from './public'

export type Draft = { document: EstimatorDocument; revision: number; updatedAt: Date; updatedBy: string | null }
export type PublishedVersion = { version: number; document: EstimatorDocument; publishedAt: Date; publishedBy: string | null }

export async function readDraft(d1: D1Database): Promise<Draft> {
  const row = await getDb(d1).select().from(estimatorDraft).where(eq(estimatorDraft.id, 1)).get()
  if (!row) throw new Error('estimator_draft row 1 is missing (migration 0001 seeds it)')
  return { document: JSON.parse(row.documentJson) as EstimatorDocument, revision: row.revision, updatedAt: row.updatedAt, updatedBy: row.updatedBy }
}

const toVersion = (row: typeof estimatorVersions.$inferSelect): PublishedVersion => ({
  version: row.version,
  document: JSON.parse(row.documentJson) as EstimatorDocument,
  publishedAt: row.publishedAt,
  publishedBy: row.publishedBy,
})

export async function readLatestVersion(d1: D1Database): Promise<PublishedVersion> {
  const row = await getDb(d1).select().from(estimatorVersions).orderBy(desc(estimatorVersions.version)).limit(1).get()
  if (!row) throw new Error('no Published version (migration 0001 seeds version 1)')
  return toVersion(row)
}

export async function readVersion(d1: D1Database, version: number): Promise<PublishedVersion | null> {
  if (!Number.isSafeInteger(version) || version < 1) return null
  const row = await getDb(d1).select().from(estimatorVersions).where(eq(estimatorVersions.version, version)).get()
  return row ? toVersion(row) : null
}

export type SaveOutcome =
  | { ok: true; revision: number }
  | { ok: false; reason: 'invalid'; fieldErrors: FieldErrors }
  | { ok: false; reason: 'stale' }

/** Compare-and-swap on `revision`: a save made from an older copy of the draft is refused, never merged. */
export async function saveDraft(d1: D1Database, raw: unknown, expectedRevision: number, by: string): Promise<SaveOutcome> {
  const v = validateSettings(raw)
  if (!v.ok) return { ok: false, reason: 'invalid', fieldErrors: v.fieldErrors }
  const res = await d1
    .prepare('UPDATE estimator_draft SET document_json = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = 1 AND revision = ?')
    .bind(JSON.stringify(v.doc), by, Date.now(), expectedRevision)
    .run()
  if (res.meta.changes !== 1) return { ok: false, reason: 'stale' }
  return { ok: true, revision: expectedRevision + 1 }
}

export type PublishOutcome =
  | { ok: true; version: number }
  | { ok: false; reason: 'invalid'; fieldErrors: FieldErrors }
  | { ok: false; reason: 'stale' }

/**
 * Publishes the draft revision the owner reviewed, as the next version number. One INSERT ... SELECT does both the
 * revision check and the numbering, so two publishes can neither share a number nor publish a draft nobody saw.
 */
export async function publishDraft(d1: D1Database, reviewedRevision: number, by: string): Promise<PublishOutcome> {
  const draft = await readDraft(d1)
  if (draft.revision !== reviewedRevision) return { ok: false, reason: 'stale' }
  const v = validateSettings(draft.document)
  if (!v.ok) return { ok: false, reason: 'invalid', fieldErrors: v.fieldErrors }
  const res = await d1
    .prepare(
      `INSERT INTO estimator_versions (version, document_json, draft_revision, published_at, published_by)
       SELECT (SELECT COALESCE(MAX(version), 0) + 1 FROM estimator_versions), document_json, revision, ?, ?
       FROM estimator_draft WHERE id = 1 AND revision = ?`,
    )
    .bind(Date.now(), by, reviewedRevision)
    .run()
  if (res.meta.changes !== 1) return { ok: false, reason: 'stale' }
  // `version` is the INTEGER PRIMARY KEY, so it is the row id SQLite reports for this insert.
  return { ok: true, version: res.meta.last_row_id }
}
