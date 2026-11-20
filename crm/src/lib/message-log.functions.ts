import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { getDb } from '#/db/client'
import { requireAdmin } from '#/lib/guards'
import { record, requiredId } from '#/lib/input'
import { type MessageLogFilter, dismissAllFailed, dismissMessage, listMessageLog, retryMessage } from '#/lib/message-log.server'

// Settings > Message log (admins). See message-log.server.ts.

export const getMessageLog = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .validator((data: { filter: MessageLogFilter }) => record(data))
  .handler(({ data }) => listMessageLog(getDb(env.DB), data.filter === 'all' ? 'all' : 'problems'))

export const retryMessageFn = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { id: string }) => record(data))
  .handler(({ data }) => retryMessage(getDb(env.DB), env, requiredId(data.id)))

export const dismissMessageFn = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { id: string }) => record(data))
  .handler(({ data }) => dismissMessage(getDb(env.DB), requiredId(data.id)))

export const dismissAllFailedFn = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .handler(() => dismissAllFailed(getDb(env.DB)))
