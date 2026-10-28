import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { type LeadFileKind, type LeadFileType, leadFiles, user } from '#/db/schema'
import { requireStaff } from '#/lib/guards'
import { record, requiredId } from '#/lib/input'
import { LEAD_FILE_SLOTS } from '#/lib/lead-files'

// Quote files (plan 009 decision 12): listing and removing are server functions; upload and download are the
// /api/lead-files routes (src/lib/lead-files.server.ts). Any Staff member may do all of it (decision 8). Nothing here
// touches the Pipeline stage, Follow-ups or lead_activity (decision 16).

export type LeadFile = {
  id: string
  kind: LeadFileKind
  fileName: string
  contentType: LeadFileType
  sizeBytes: number
  uploadedAt: Date
  uploadedByName: string | null
}

/** The Lead's current Quote file in each slot (null = empty), with the uploader's name. */
export const listLeadFiles = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { leadId: string }) => record(data))
  .handler(async ({ data }) => {
    const rows = await getDb(env.DB)
      .select({
        id: leadFiles.id,
        kind: leadFiles.kind,
        fileName: leadFiles.fileName,
        contentType: leadFiles.contentType,
        sizeBytes: leadFiles.sizeBytes,
        uploadedAt: leadFiles.uploadedAt,
        uploadedByName: user.name,
      })
      .from(leadFiles)
      .leftJoin(user, eq(user.id, leadFiles.uploadedBy))
      .where(and(eq(leadFiles.leadId, requiredId(data.leadId)), isNull(leadFiles.removedAt)))
    const files = Object.fromEntries(LEAD_FILE_SLOTS.map((kind) => [kind, null])) as Record<LeadFileKind, LeadFile | null>
    for (const row of rows) files[row.kind] = row
    return files
  })

/** Soft-removes a current Quote file: the row is kept with `removed_at` and the R2 object stays. 404 if not current. */
export const removeLeadFile = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { fileId: string }) => record(data))
  .handler(async ({ data, context: { staff } }) => {
    const removed = await getDb(env.DB)
      .update(leadFiles)
      .set({ removedAt: new Date(), removedBy: staff.id, removedReason: 'removed' })
      .where(and(eq(leadFiles.id, requiredId(data.fileId)), isNull(leadFiles.removedAt)))
      .returning({ id: leadFiles.id })
    if (!removed.length) throw new Response('This file was already replaced or removed. Reload.', { status: 404 })
    return { ok: true }
  })
