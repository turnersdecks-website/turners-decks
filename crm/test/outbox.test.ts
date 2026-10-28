import { env } from 'cloudflare:test'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { type JobOutcome, dispatchDueJobs, dispatchJob } from '#/lib/outbox'
import { JOB_KINDS } from '#/lib/outbox-kinds'
import { accepted, enqueueTestEmail, mockResend, readJob, resendDown, sendingEnv } from './outbox-helpers'

const MIN = 60_000
const HOUR = 60 * MIN

/** Records what the outbox reports to the job kind's hook. */
function listenToOutcomes() {
  const outcomes: Array<{ jobId: string; outcome: JobOutcome }> = []
  const original = JOB_KINDS.password_reset
  JOB_KINDS.password_reset = { ...original, onOutcome: (outcome, job) => (outcomes.push({ jobId: job.id, outcome }), []) }
  onTestFinished(() => void (JOB_KINDS.password_reset = original))
  return { outcomesFor: (id: string) => outcomes.filter((o) => o.jobId === id).map((o) => o.outcome) }
}

/** Runs the cron every 5 minutes for `hours`, starting at `start`. */
async function runCron(start: number, hours: number, fetch: typeof globalThis.fetch) {
  for (let t = start; t <= start + hours * HOUR; t += 5 * MIN) await dispatchDueJobs(sendingEnv, { fetch, now: () => t })
}

// FLW-143 / PLAN.md > Architecture (Email): notification outbox with atomic leases, sent through Resend.

afterEach(() => vi.restoreAllMocks())

it('two dispatchers racing for the same job send it once', async () => {
  const resend = mockResend()
  const id = await enqueueTestEmail()

  await Promise.all([dispatchJob(sendingEnv, id, { fetch: resend.fetch }), dispatchJob(sendingEnv, id, { fetch: resend.fetch })])

  expect(resend.callsFor(id)).toHaveLength(1)
  expect(await readJob(id)).toMatchObject({ state: 'sent', attempts: 1 })
})

it('while Resend is down a job is retried with backoff, then marked dead and reported', async () => {
  const resend = mockResend(() => resendDown())
  const hook = listenToOutcomes()
  const id = await enqueueTestEmail()
  const start = Date.now()

  await dispatchJob(sendingEnv, id, { fetch: resend.fetch, now: () => start })
  expect(await readJob(id)).toMatchObject({ state: 'failed', attempts: 1 })

  await runCron(start, 1, resend.fetch)
  expect(resend.callsFor(id).length).toBeLessThan(6)

  await runCron(start + HOUR, 3, resend.fetch)
  const calls = resend.callsFor(id)
  expect(calls).toHaveLength(6)
  expect(new Set(calls.map((c) => c.idempotencyKey))).toEqual(new Set([id]))
  expect(await readJob(id)).toMatchObject({ state: 'dead', attempts: 6 })
  expect(hook.outcomesFor(id)).toEqual([{ type: 'dead', error: expect.stringContaining('500') }])
})

it('once Resend recovers the job is sent exactly once and the hook hears Resend’s email id', async () => {
  const resend = mockResend((_call, n) => (n <= 2 ? resendDown() : accepted('email_recovered_1')))
  const hook = listenToOutcomes()
  const id = await enqueueTestEmail()
  const start = Date.now()

  await dispatchJob(sendingEnv, id, { fetch: resend.fetch, now: () => start })
  await runCron(start, 4, resend.fetch)

  expect(resend.callsFor(id)).toHaveLength(3)
  expect(await readJob(id)).toMatchObject({ state: 'sent', attempts: 3, provider_message_id: 'email_recovered_1', last_error: null })
  expect(hook.outcomesFor(id)).toEqual([{ type: 'accepted', resendId: 'email_recovered_1' }])
})

it('an email Resend refuses outright is not retried and is reported as failed', async () => {
  const resend = mockResend(() => Response.json({ name: 'validation_error', message: 'Invalid `to` field.' }, { status: 422 }))
  const hook = listenToOutcomes()
  const id = await enqueueTestEmail()
  const start = Date.now()

  await dispatchJob(sendingEnv, id, { fetch: resend.fetch, now: () => start })
  await runCron(start, 2, resend.fetch)

  expect(resend.callsFor(id)).toHaveLength(1)
  expect(await readJob(id)).toMatchObject({ state: 'dead' })
  expect(hook.outcomesFor(id)).toEqual([{ type: 'failed', error: expect.stringContaining('422') }])
})

it('a dispatcher that outlives its lease cannot overwrite the dispatcher that took the job over', async () => {
  let releaseStuck!: (r: Response) => void
  const stuck = mockResend(() => new Promise<Response>((resolve) => (releaseStuck = resolve)))
  const healthy = mockResend(() => accepted('email_second_claimer'))
  const id = await enqueueTestEmail()
  const start = Date.now()

  const first = dispatchJob(sendingEnv, id, { fetch: stuck.fetch, now: () => start })
  await vi.waitFor(() => expect(stuck.callsFor(id)).toHaveLength(1))
  await dispatchJob(sendingEnv, id, { fetch: healthy.fetch, now: () => start + 3 * MIN })
  releaseStuck(resendDown())
  await first

  expect(healthy.callsFor(id)).toHaveLength(1)
  expect(await readJob(id)).toMatchObject({ state: 'sent', provider_message_id: 'email_second_claimer' })
})

it('a job still unresolved after Resend’s 24-hour idempotency window is marked dead, never auto-resent', async () => {
  const stuck = mockResend(() => new Promise<Response>(() => {}))
  const resend = mockResend()
  const hook = listenToOutcomes()
  const id = await enqueueTestEmail()
  const start = Date.now()

  void dispatchJob(sendingEnv, id, { fetch: stuck.fetch, now: () => start }) // the Worker dies mid-send
  await vi.waitFor(() => expect(stuck.callsFor(id)).toHaveLength(1))
  await dispatchDueJobs(sendingEnv, { fetch: resend.fetch, now: () => start + 25 * HOUR })

  expect(resend.callsFor(id)).toHaveLength(0)
  expect(await readJob(id)).toMatchObject({ state: 'dead' })
  expect(hook.outcomesFor(id)).toEqual([{ type: 'dead', error: expect.stringContaining('24 h') }])
})

it('without a Resend key nothing is sent and jobs wait; once the key exists they go out', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const fetch = vi.spyOn(globalThis, 'fetch')
  const id = await enqueueTestEmail('dana.whitcomb@example.com')

  await dispatchJob(env, id)
  await dispatchDueJobs(env)

  expect(fetch).not.toHaveBeenCalled()
  expect(await readJob(id)).toMatchObject({ state: 'pending', attempts: 0 })
  const lines = warn.mock.calls.map((c) => JSON.parse(String(c[0])))
  expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', msg: expect.stringContaining('RESEND_API_KEY') }))
  expect(JSON.stringify(lines)).not.toContain('dana.whitcomb')

  const resend = mockResend()
  await dispatchJob(sendingEnv, id, { fetch: resend.fetch })
  expect(resend.callsFor(id)).toHaveLength(1)
  expect(resend.callsFor(id)[0]).toMatchObject({ authorization: 'Bearer re_test_key_0001', body: { to: ['dana.whitcomb@example.com'] } })
})

it('logs are structured JSON with no recipient address, subject or body', async () => {
  const lines: string[] = []
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((l) => void lines.push(String(l)))
  const resend = mockResend((_c, n) => (n === 1 ? Response.json({ message: 'dana.whitcomb@example.com bounced' }, { status: 503 }) : accepted()))
  const id = await enqueueTestEmail('dana.whitcomb@example.com')
  const start = Date.now()

  await dispatchJob(sendingEnv, id, { fetch: resend.fetch, now: () => start })
  await dispatchJob(sendingEnv, id, { fetch: resend.fetch, now: () => start + HOUR })

  const mine = lines.map((l) => JSON.parse(l)).filter((l) => l.job_id === id)
  expect(mine.map((l) => [l.level, l.msg])).toEqual([
    ['warn', 'email job will retry'],
    ['info', 'email job accepted'],
  ])
  const raw = JSON.stringify(mine)
  expect(raw).not.toContain('dana.whitcomb')
  expect(raw).not.toContain('SECRET-TOKEN')
  expect(raw).not.toContain('Reset your')
  expect(mine[0]).toMatchObject({ to: 'd***@example.com', status: 503 })
})

it('a password reset link does not stay in the outbox once the email is sent', async () => {
  const resend = mockResend()
  const id = await enqueueTestEmail()

  await dispatchJob(sendingEnv, id, { fetch: resend.fetch })

  expect(resend.callsFor(id)[0].body.text).toContain('SECRET-TOKEN')
  expect((await readJob(id))!.payload_json).not.toContain('SECRET-TOKEN')
})

it('a slow sweep gives each job a lease from its own claim time, so a later job is not re-claimable mid-send', async () => {
  const first = await enqueueTestEmail()
  const second = await enqueueTestEmail()
  let clock = Date.now()
  await env.DB.prepare('UPDATE notification_jobs SET next_attempt_at = ? WHERE id = ?').bind(clock - 1000, first).run()
  const slow = mockResend(async (call) => {
    if (call.idempotencyKey === first) clock += 3 * MIN // a slow send: the sweep's clock moves on
    if (call.idempotencyKey === second) return new Promise<Response>(() => {})
    return accepted()
  })
  const rival = mockResend()

  void dispatchDueJobs(sendingEnv, { fetch: slow.fetch, now: () => clock })
  await vi.waitFor(() => expect(slow.callsFor(second)).toHaveLength(1))
  await dispatchJob(sendingEnv, second, { fetch: rival.fetch, now: () => clock })

  expect(rival.callsFor(second)).toHaveLength(0)
})

it('a Worker that dies during the last allowed attempt is not followed by a 7th send: recovery marks the job dead', async () => {
  const down = mockResend(() => resendDown())
  const stuck = mockResend(() => new Promise<Response>(() => {}))
  const resend = mockResend()
  const hook = listenToOutcomes()
  const id = await enqueueTestEmail()
  let now = Date.now()

  for (let i = 0; i < 5; i++) {
    await dispatchJob(sendingEnv, id, { fetch: down.fetch, now: () => now })
    now += HOUR
  }
  void dispatchJob(sendingEnv, id, { fetch: stuck.fetch, now: () => now }) // attempt 6; the Worker dies mid-send
  await vi.waitFor(() => expect(stuck.callsFor(id)).toHaveLength(1))
  await dispatchDueJobs(sendingEnv, { fetch: resend.fetch, now: () => now + 3 * MIN })

  expect(resend.callsFor(id)).toHaveLength(0)
  expect(await readJob(id)).toMatchObject({ state: 'dead' })
  expect(hook.outcomesFor(id)).toEqual([{ type: 'dead', error: expect.stringContaining('attempt') }])
})
