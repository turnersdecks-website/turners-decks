import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { alarmDays, cronRuns, formSubmissions, notificationJobs, submissionProcessing } from '#/db/schema'
import { sweepDeletedLeadPrefixes } from '#/lib/lead-files.server'
import { type DispatchDeps, type OutboxEnv, dispatchDueJobs } from '#/lib/outbox'

// Cron Triggers: each schedule in wrangler.jsonc > triggers.crons maps to its tasks here. To add a job, add the
// schedule to wrangler.jsonc and a task under the same string (e.g. a daily '0 11 * * *').

export const OUTBOX_CRON = '*/5 * * * *'
/** The dashboard banner shows once the 5-minute cron has missed about two runs (PLAN.md > Observability). */
export const CRON_STALE_AFTER_MS = 15 * 60_000
/** Backlog alarms (PLAN.md > Observability): jobs failed/dead for over 1 hour, submissions unprocessed over 15 min. */
export const JOB_ALARM_AFTER_MS = 60 * 60_000
export const SUBMISSION_ALARM_AFTER_MS = 15 * 60_000
/**
 * Dead jobs and failed submissions stay until purged (400 days), so only those from the last week count: older ones
 * are on the Jobs and Submissions screens, not a banner forever.
 */
const ALARM_LOOKBACK_MS = 7 * 24 * 60 * 60_000

export type CronEnv = OutboxEnv & Pick<Env, 'LEAD_FILES'>
/** `fetch` / `now` seams for tests. */
export type CronDeps = DispatchDeps
type CronTask = { name: string; run: (env: CronEnv, deps: CronDeps) => Promise<void> }

export const CRON_TASKS: Record<string, CronTask[]> = {
  [OUTBOX_CRON]: [
    { name: 'outbox', run: (env, deps) => dispatchDueJobs(env, deps) },
    { name: 'backlog-alarms', run: (env, deps) => checkBacklog(env.DB, deps.now?.() ?? Date.now()) },
    // Quote files of deleted Leads (plan 009 decision 15): each deleted Lead's R2 prefix, swept three times.
    { name: 'r2-cleanup', run: (env, deps) => sweepDeletedLeadPrefixes(env, { now: deps.now }) },
  ],
}

/**
 * Records the run (cron health), then runs every task for `cron`; one failing task does not stop the others.
 * Rethrows so Cloudflare records a failed run.
 */
export async function runScheduled(cron: string, env: CronEnv, deps: CronDeps = {}): Promise<void> {
  const tasks = CRON_TASKS[cron]
  if (!tasks) return log({ msg: 'no tasks for cron schedule', cron })
  await recordRun(env.DB, cron, deps.now?.() ?? Date.now())
  const results = await Promise.allSettled(tasks.map((t) => t.run(env, deps)))
  const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [{ task: tasks[i].name, error: String(r.reason).slice(0, 500) }] : []))
  for (const f of failed) log({ msg: 'cron task failed', cron, ...f })
  if (failed.length) throw new Error(`cron ${cron}: ${failed.map((f) => f.task).join(', ')} failed`)
}

/** Never throws: a failed health write must not stop the tasks (the banner then shows, which is the point). */
async function recordRun(d1: D1Database, cron: string, now: number) {
  try {
    const lastRunAt = new Date(now)
    await getDb(d1).insert(cronRuns).values({ cron, lastRunAt }).onConflictDoUpdate({ target: cronRuns.cron, set: { lastRunAt } })
  } catch (err) {
    log({ msg: 'cron run not recorded', cron, error: String(err).slice(0, 500) })
  }
}

/** Whether `cron` (default: the 5-minute outbox cron) has gone CRON_STALE_AFTER_MS without running; never run = stale. */
export async function readCronHealth(d1: D1Database, now: number, cron = OUTBOX_CRON) {
  const [row] = await getDb(d1).select({ lastRunAt: cronRuns.lastRunAt }).from(cronRuns).where(eq(cronRuns.cron, cron))
  const lastRunAt = row?.lastRunAt ?? null
  return { stale: !lastRunAt || now - lastRunAt.getTime() > CRON_STALE_AFTER_MS, lastRunAt }
}

/** How many jobs and Form submissions are stuck past their alarm age (the dashboard warnings). */
export async function readBacklog(d1: D1Database, now: number) {
  const db = getDb(d1)
  const since = now - ALARM_LOOKBACK_MS
  const jobCreated = sql`coalesce(${notificationJobs.createdAt}, ${notificationJobs.firstAttemptAt})`
  const [jobs, submissions] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(notificationJobs)
      .where(and(inArray(notificationJobs.state, ['failed', 'dead']), lt(jobCreated, now - JOB_ALARM_AFTER_MS), gte(jobCreated, since)))
      .get(),
    db
      .select({ n: sql<number>`count(*)` })
      .from(submissionProcessing)
      .innerJoin(formSubmissions, eq(formSubmissions.id, submissionProcessing.submissionId))
      .where(
        and(
          inArray(submissionProcessing.state, ['received', 'processing', 'failed']),
          lt(formSubmissions.receivedAt, new Date(now - SUBMISSION_ALARM_AFTER_MS)),
          gte(formSubmissions.receivedAt, new Date(since)),
        ),
      )
      .get(),
  ])
  return { stuckJobs: jobs?.n ?? 0, stuckSubmissions: submissions?.n ?? 0 }
}

/** The 5-minute check: a level=error line per stuck condition, at most once per condition per UTC day. */
async function checkBacklog(d1: D1Database, now: number) {
  const { stuckJobs, stuckSubmissions } = await readBacklog(d1, now)
  const day = new Date(now).toISOString().slice(0, 10)
  const alarm = async (condition: string, count: number, msg: string) => {
    if (!count) return
    const [first] = await getDb(d1).insert(alarmDays).values({ condition, day }).onConflictDoNothing().returning()
    if (first) log({ msg, condition, count })
  }
  await alarm('stuck_jobs', stuckJobs, 'email jobs failed or dead for over 1 hour')
  await alarm('stuck_submissions', stuckSubmissions, 'form submissions unprocessed for over 15 minutes')
}

function log(fields: Record<string, unknown>) {
  console.error(JSON.stringify({ level: 'error', ...fields }))
}
