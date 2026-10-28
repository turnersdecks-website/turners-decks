import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CRON_TASKS, OUTBOX_CRON, readBacklog, readCronHealth, runScheduled } from '#/lib/cron'
import { getCronHealth } from '#/lib/cron-health.functions'
import { deleteLeadRecordingFiles } from '#/lib/leads.server'
import { insertLead } from './lead-helpers'
import { enqueueTestEmail, mockResend, readJob, sendingEnv } from './outbox-helpers'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// Cron Triggers (wrangler.jsonc > triggers.crons) land in the Worker's `scheduled` handler (src/server.ts).

afterEach(() => vi.restoreAllMocks())

it('the 5-minute cron sends due outbox jobs', async () => {
  const resend = mockResend()
  const id = await enqueueTestEmail()

  await runScheduled(OUTBOX_CRON, sendingEnv, { fetch: resend.fetch })

  expect(resend.callsFor(id)).toHaveLength(1)
  expect(await readJob(id)).toMatchObject({ state: 'sent' })
})

// Quote files of deleted Leads (plan 009 decision 15): `r2-cleanup` runs with the outbox every 5 minutes.
it('the 5-minute cron runs r2-cleanup: a deleted Lead\'s prefix is swept once due', async () => {
  const T = 2_000_000_000_000
  const leadId = await insertLead()
  await env.LEAD_FILES.put(`leads/${leadId}/file`, 'bytes')
  await deleteLeadRecordingFiles(env.DB, leadId, T)

  await runScheduled(OUTBOX_CRON, env, { now: () => T + 5 * 60_000 })

  expect(CRON_TASKS[OUTBOX_CRON].map((t) => t.name)).toContain('r2-cleanup')
  expect((await env.LEAD_FILES.list({ prefix: `leads/${leadId}/` })).objects).toEqual([])
  expect(await env.DB.prepare('SELECT sweeps_done FROM r2_prefix_deletes WHERE prefix = ?').bind(`leads/${leadId}/`).first('sweeps_done')).toBe(1)
})

it('a cron schedule with no tasks logs an error', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})

  await runScheduled('0 0 1 1 *', sendingEnv)

  expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ level: 'error', msg: 'no tasks for cron schedule', cron: '0 0 1 1 *' })
})

// PLAN.md > Observability: a cron health check separate from the outbox. Each scheduled run is recorded; Staff see a
// dashboard banner when the 5-minute cron has not run for 15 minutes.
describe('cron health', () => {
  const MIN = 60_000
  const T = 1_800_000_000_000

  it('is healthy within 15 minutes of the last 5-minute run, stale after', async () => {
    await runScheduled(OUTBOX_CRON, sendingEnv, { now: () => T })

    expect(await readCronHealth(env.DB, T + 14 * MIN)).toEqual({ stale: false, lastRunAt: new Date(T) })
    expect(await readCronHealth(env.DB, T + 16 * MIN)).toEqual({ stale: true, lastRunAt: new Date(T) })
  })

  it('a later run clears it', async () => {
    await runScheduled(OUTBOX_CRON, sendingEnv, { now: () => T })
    await runScheduled(OUTBOX_CRON, sendingEnv, { now: () => T + 20 * MIN })

    expect(await readCronHealth(env.DB, T + 21 * MIN)).toEqual({ stale: false, lastRunAt: new Date(T + 20 * MIN) })
  })

  it('any Staff member can read it for the dashboard banner', async () => {
    const { cookie } = await signedInStaff('staff')
    await runScheduled(OUTBOX_CRON, sendingEnv, { now: () => Date.now() - 20 * MIN })

    const stale = await serverFnResult<{ stale: boolean }>(await callServerFn(getCronHealth, cookie))
    await runScheduled(OUTBOX_CRON, sendingEnv)
    const fresh = await serverFnResult<{ stale: boolean }>(await callServerFn(getCronHealth, cookie))

    expect(stale.stale).toBe(true)
    expect(fresh.stale).toBe(false)
  })

  it('a cron that has never run is stale', async () => {
    expect(await readCronHealth(env.DB, T, '0 0 2 1 *')).toEqual({ stale: true, lastRunAt: null })
  })
})

// PLAN.md > Observability: backlog alarms. Jobs failed/dead for over an hour and submissions unprocessed for over 15
// minutes log a structured level=error line (once per condition per day) and show on the dashboard until resolved.
describe('backlog alarms', () => {
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR
  // Its own stretch of time, well after anything the other tests in this file leave behind.
  const B = 1_900_000_000_000

  const alarmLines = (error: { mock: { calls: unknown[][] } }, msg: string) =>
    error.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((l) => l.msg === msg)

  async function insertJob(state: string, createdAt: number) {
    const id = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO notification_jobs (id, kind, payload_json, dedupe_key, state, attempts, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .bind(id, 'owner_alert', '{}', `test:${id}`, state, createdAt)
      .run()
    return id
  }

  async function insertSubmission(state: string, receivedAt: number) {
    const id = crypto.randomUUID()
    await env.DB.batch([
      env.DB.prepare('INSERT INTO form_submissions (id, submission_key, fingerprint, received_at, schema_version, raw_body) VALUES (?, ?, ?, ?, 1, ?)').bind(
        id,
        id,
        'fp',
        receivedAt,
        '{}',
      ),
      env.DB.prepare('INSERT INTO submission_processing (submission_id, state) VALUES (?, ?)').bind(id, state),
    ])
    return id
  }

  it('a job failed for over an hour: one level=error line per day and a dashboard warning, gone once it is resolved', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fresh = await insertJob('failed', B - 30 * MIN)
    expect(await readBacklog(env.DB, B)).toMatchObject({ stuckJobs: 0 })

    const job = await insertJob('dead', B - 2 * HOUR)
    await runScheduled(OUTBOX_CRON, env, { now: () => B })
    await runScheduled(OUTBOX_CRON, env, { now: () => B + 5 * MIN })
    expect(alarmLines(error, 'email jobs failed or dead for over 1 hour')).toEqual([
      expect.objectContaining({ level: 'error', count: 1 }),
    ])
    expect(await readBacklog(env.DB, B + 5 * MIN)).toMatchObject({ stuckJobs: 1 })

    await runScheduled(OUTBOX_CRON, env, { now: () => B + DAY })
    expect(alarmLines(error, 'email jobs failed or dead for over 1 hour')).toHaveLength(2)

    await env.DB.prepare("UPDATE notification_jobs SET state = 'sent' WHERE id IN (?, ?)").bind(job, fresh).run()
    await runScheduled(OUTBOX_CRON, env, { now: () => B + 2 * DAY })
    expect(alarmLines(error, 'email jobs failed or dead for over 1 hour')).toHaveLength(2)
    expect(await readBacklog(env.DB, B + 2 * DAY)).toMatchObject({ stuckJobs: 0 })
  })

  it('a submission unprocessed for over 15 minutes alarms once per day and clears once processed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const S = B + 10 * DAY
    const id = await insertSubmission('processing', S - 20 * MIN)
    await insertSubmission('received', S - 5 * MIN)

    await runScheduled(OUTBOX_CRON, env, { now: () => S })
    await runScheduled(OUTBOX_CRON, env, { now: () => S + 5 * MIN })

    expect(alarmLines(error, 'form submissions unprocessed for over 15 minutes')).toEqual([
      expect.objectContaining({ level: 'error', count: 1 }),
    ])
    expect(await readBacklog(env.DB, S)).toMatchObject({ stuckSubmissions: 1 })

    await env.DB.prepare("UPDATE submission_processing SET state = 'processed' WHERE submission_id = ?").bind(id).run()
    expect(await readBacklog(env.DB, S + 6 * MIN)).toMatchObject({ stuckSubmissions: 0 })
  })

  it('any Staff member sees the backlog with the cron health for the dashboard', async () => {
    const { cookie } = await signedInStaff('staff')

    const health = await serverFnResult<Record<string, unknown>>(await callServerFn(getCronHealth, cookie))

    expect(health).toMatchObject({ stale: expect.any(Boolean), stuckJobs: expect.any(Number), stuckSubmissions: expect.any(Number) })
  })
})
