import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { leadActivity } from '#/db/schema'
import { requireStaff } from '#/lib/guards'
import { badRequest, record, requiredId } from '#/lib/input'

// Follow-ups (GLOSSARY): dated reminders for Staff to contact a Lead again. A Follow-up is a `lead_activity`
// row with `follow_up_at`; `follow_up_done_at` marks it done. Good Cover v1 sets and completes them on the Lead page;
// Pine & Gable's Follow-up queue (/tasks, listFollowUps, rescheduleFollowUp) comes back with Tasks.

const notFound = () => new Response('Follow-up not found', { status: 404 })

/** Marks a Follow-up done (now) or reopens it. */
export const setFollowUpDone = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { activityId: string; done: boolean }) => record(data))
  .handler(async ({ data }) => {
    const activityId = requiredId(data.activityId)
    if (typeof data.done !== 'boolean') throw badRequest('done must be true or false.')
    const updated = await getDb(env.DB)
      .update(leadActivity)
      .set({ followUpDoneAt: data.done ? new Date() : null })
      .where(and(eq(leadActivity.id, activityId), isNotNull(leadActivity.followUpAt)))
      .returning({ followUpDoneAt: leadActivity.followUpDoneAt })
    if (!updated.length) throw notFound()
    return updated[0]
  })
