import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { getDb } from '#/db/client'
import { requireStaff } from '#/lib/guards'
import { record, requiredId } from '#/lib/input'
import { markLost, previewLost } from '#/lib/lost.server'

// The Lost window (src/lib/lost.server.ts).

/** The thank-you email as it would go out, and whether it can be sent. */
export const getLostPreview = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { leadId: string }) => record(data))
  .handler(({ data }) => previewLost(getDb(env.DB), env, requiredId(data.leadId)))

/** Moves the Lead to Lost with the choices from the window. */
export const markLeadLost = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { leadId: string; sendEmail: boolean; doNotContact: boolean; reason?: string | null }) => record(data))
  .handler(({ data, context: { staff } }) =>
    markLost(
      getDb(env.DB),
      env,
      { leadId: requiredId(data.leadId), sendEmail: data.sendEmail === true, doNotContact: data.doNotContact === true, reason: typeof data.reason === 'string' ? data.reason : null },
      staff.id,
    ),
  )
