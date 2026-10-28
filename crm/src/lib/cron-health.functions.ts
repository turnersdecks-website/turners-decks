import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { readBacklog, readCronHealth } from '#/lib/cron'
import { requireStaff } from '#/lib/guards'

/** Whether the 5-minute cron has stopped running and what is stuck, for the dashboard banners (any Staff member). */
export const getCronHealth = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async () => {
    const now = Date.now()
    const [health, backlog] = await Promise.all([readCronHealth(env.DB, now), readBacklog(env.DB, now)])
    return { ...health, ...backlog }
  })
