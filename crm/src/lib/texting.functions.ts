import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { getDb } from '#/db/client'
import { requireAdmin, requireStaff } from '#/lib/guards'
import { record } from '#/lib/input'
import { connectQuo, readTextingSettings, saveTextingSettings, textingStatus } from '#/lib/texting.server'

// Settings > Texting (docs/adr/0004-quo-texting.md). The work is in texting.server.ts.

/** Admins: connection, switch, Pat's cell, and the webhook address. */
export const getTextingSettings = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(() => readTextingSettings(getDb(env.DB), env))

/** Admins: "Connect Quo". `phone` picks the Quo number when the workspace has more than one. */
export const connectQuoNumber = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { phone?: string | null }) => record(data))
  .handler(({ data, context: { staff } }) => connectQuo(getDb(env.DB), env, typeof data.phone === 'string' && data.phone.trim() ? data.phone : null, staff.id))

/** Admins: texting on or off (on only after A2P approval), and Pat's cell. */
export const updateTextingSettings = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { textingEnabled: boolean; ownerMobile: string }) => record(data))
  .handler(({ data }) => saveTextingSettings(getDb(env.DB), env, data))

/** Any Staff: whether the CRM can text right now (shows "Text Pat from Quo" on photo links). */
export const getTextingReady = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async () => ({ ready: (await textingStatus(getDb(env.DB), env)).ready }))
