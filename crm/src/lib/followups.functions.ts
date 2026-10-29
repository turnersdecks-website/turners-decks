import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { getDb } from '#/db/client'
import { requireStaff } from '#/lib/guards'
import { badRequest, record, requiredId } from '#/lib/input'
import { setFollowUpDoneRecord } from '#/lib/leads.server'

// Follow-ups (GLOSSARY): dated reminders for Staff to contact a Lead again. A Follow-up is a `lead_activity`
// row with `follow_up_at`; `follow_up_done_at` marks it done. Good Cover v1 sets and completes them on the Lead page;
// Pine & Gable's Follow-up queue (/tasks, listFollowUps, rescheduleFollowUp) comes back with Tasks.

/** Marks a Follow-up done (now) or reopens it. */
export const setFollowUpDone = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { activityId: string; done: boolean }) => record(data))
  .handler(async ({ data }) => {
    const activityId = requiredId(data.activityId)
    if (typeof data.done !== 'boolean') throw badRequest('done must be true or false.')
    return setFollowUpDoneRecord(getDb(env.DB), activityId, data.done)
  })
