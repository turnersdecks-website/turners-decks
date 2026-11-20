import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/db/client'
import { readBacklog } from '#/lib/cron'
import { dismissAllFailed, dismissMessage, listMessageLog, retryMessage } from '#/lib/message-log.server'

// Settings > Message log (message-log.server.ts): failed messages are listed with their error, can be sent again or
// dismissed, and dismissed ones stop counting toward the "failed for over an hour" banner.

const HOUR = 60 * 60_000
async function insertJob(state: string, createdAt: number, extra: { outcome?: string; lastError?: string } = {}) {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO notification_jobs (id, kind, dedupe_key, payload_json, state, outcome, attempts, last_error, next_attempt_at, created_at)
     VALUES (?, 'owner_alert', ?, ?, ?, ?, 3, ?, ?, ?)`,
  )
    .bind(id, `log:${id}`, JSON.stringify({ to: ['owner@example.com'], subject: 'New Lead: Test', text: 'x' }), state, extra.outcome ?? null, extra.lastError ?? null, createdAt, createdAt)
    .run()
  return id
}

describe('Message log', () => {
  it('lists a failed email with its error; Dismiss clears it from the banner; Retry queues it again', async () => {
    await dismissAllFailed(getDb(env.DB)) // start from a clean banner
    const now = Date.now()
    const dead = await insertJob('dead', now - 3 * HOUR, { lastError: 'Resend 422: invalid to address' })
    const other = await insertJob('failed', now - 2 * HOUR, { lastError: 'Resend 500' })
    const sent = await insertJob('sent', now - HOUR)
    expect((await readBacklog(env.DB, now)).stuckJobs).toBe(2)

    const problems = await listMessageLog(getDb(env.DB), 'problems', now)
    expect(problems.map((r) => r.id)).toEqual(expect.arrayContaining([dead, other]))
    expect(problems.map((r) => r.id)).not.toContain(sent)
    expect(problems.find((r) => r.id === dead)).toMatchObject({ status: 'failed', label: 'New Lead alert', to: 'owner@example.com', error: 'Resend 422: invalid to address' })

    await dismissMessage(getDb(env.DB), dead)
    expect((await readBacklog(env.DB, now)).stuckJobs).toBe(1)
    expect((await listMessageLog(getDb(env.DB), 'all', now)).find((r) => r.id === dead)?.status).toBe('dismissed')

    await retryMessage(getDb(env.DB), env, other, now)
    const row = await env.DB.prepare('SELECT state, attempts, first_attempt_at FROM notification_jobs WHERE id = ?').bind(other).first()
    expect(row).toMatchObject({ attempts: 0, first_attempt_at: null })
    expect(['pending', 'claimed', 'failed', 'dead', 'sent']).toContain(row!.state)
    await expect(retryMessage(getDb(env.DB), env, sent, now)).rejects.toBeInstanceOf(Response)
  })
})
