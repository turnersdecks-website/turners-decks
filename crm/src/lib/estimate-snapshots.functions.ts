import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { estimateSnapshots } from '#/db/schema'
import { requireStaff } from '#/lib/guards'
import { record, requiredId } from '#/lib/input'
import type { PublicQuestion } from '#/lib/estimator/public'

// The Lead page's Estimate tab (FLW-203): every Estimate snapshot on the Lead, newest first. Any Staff member may read
// them. Snapshots carry the questions as the Homeowner saw them, so nothing here reads an older Published version.

/** A stored answer: a choice value, a list of values, a number, a yes/no, or the deck sections. */
export type AnswerValue = string | number | boolean | string[] | { width: number; depth: number }[]

export type EstimateSnapshotView = {
  id: string
  createdAt: number
  version: number
  questions: Record<string, PublicQuestion>
  answers: Record<string, AnswerValue>
  defaulted: string[]
  lineItems: Record<string, number>
  flags: string[]
  low: number
  mid: number
  high: number
  belowMinimum: boolean
  sqft: number
  railingLf: number
  serviceArea: string
}

export const listEstimateSnapshots = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { leadId: string }) => record(data))
  .handler(async ({ data }): Promise<EstimateSnapshotView[]> => {
    const rows = await getDb(env.DB)
      .select()
      .from(estimateSnapshots)
      .where(eq(estimateSnapshots.leadId, requiredId(data.leadId)))
      .orderBy(desc(estimateSnapshots.createdAt), desc(estimateSnapshots.id))
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.getTime(),
      version: r.version,
      questions: JSON.parse(r.questionsJson) as Record<string, PublicQuestion>,
      answers: JSON.parse(r.answersJson) as Record<string, AnswerValue>,
      defaulted: JSON.parse(r.defaultedJson) as string[],
      lineItems: JSON.parse(r.lineItemsJson) as Record<string, number>,
      flags: JSON.parse(r.flagsJson) as string[],
      low: r.low,
      mid: r.mid,
      high: r.high,
      belowMinimum: r.belowMinimum,
      sqft: r.sqft,
      railingLf: r.railingLf,
      serviceArea: r.serviceArea,
    }))
  })
