import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { handleIntake, replayFormSubmission } from '#/lib/intake'
import { intakeRequest, mockSiteverify, postIntake, inspectionFormPayload, randomPhone, siteverifyCalls } from './intake-helpers'

// PLAN.md > Intake contract: the submission_key is looked up before Turnstile is redeemed.

let siteverify: ReturnType<typeof mockSiteverify>
beforeEach(() => {
  // Real Turnstile tokens are single use: a second redemption answers timeout-or-duplicate.
  const redeemed = new Set<string>()
  siteverify = mockSiteverify(({ response }) => {
    if (redeemed.has(response)) return { success: false, 'error-codes': ['timeout-or-duplicate'] }
    redeemed.add(response)
    return { success: true, hostname: 'example.com', action: '' }
  })
})
afterEach(() => vi.restoreAllMocks())

function submission(overrides: Record<string, unknown> = {}) {
  return inspectionFormPayload({
    submission_key: crypto.randomUUID(),
    turnstile_token: `token-${crypto.randomUUID()}`,
    phone: randomPhone(),
    email: `${crypto.randomUUID()}@example.com`,
    ...overrides,
  })
}

async function count(sql: string, ...binds: unknown[]) {
  return (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n
}

it('a retry after a lost response, with the already-used token, gets the stored result', async () => {
  const body = submission()
  const first = await (await postIntake(body)).json<{ lead_id: string }>()

  const retry = await postIntake(body)

  expect(retry.status).toBe(200)
  expect(await retry.json()).toEqual({ ok: true, success: true, lead_id: first.lead_id })
  expect(siteverifyCalls(siteverify)).toBe(1)
  expect(await count('SELECT COUNT(*) AS n FROM form_submissions WHERE submission_key = ?', body.submission_key)).toBe(1)
})

it('a retry with a fresh token, new timestamp and new device size is still the same submission', async () => {
  const body = submission()
  const first = await (await postIntake(body)).json<{ lead_id: string }>()

  const retry = await postIntake({
    ...body,
    turnstile_token: 'another-token',
    submission_timestamp: '2026-10-13T12:05:00.000Z',
    device_type: 'desktop',
    landing_page_url: 'https://turnersdecks.com/quote',
  })

  expect(retry.status).toBe(200)
  expect(await retry.json()).toMatchObject({ lead_id: first.lead_id })
})

it('a corrected form sent under the same key is refused with 409 before Turnstile', async () => {
  const body = submission()
  await postIntake(body)

  const corrected = await postIntake({ ...body, message: 'Actually it is the chimney flashing.', turnstile_token: 'fresh' })

  expect(corrected.status).toBe(409)
  expect(await corrected.json()).toMatchObject({ ok: false, success: false, error: 'fingerprint_mismatch' })
  expect(siteverifyCalls(siteverify)).toBe(1)
})

it('a corrected form under a new key is a new Form submission for the same Lead', async () => {
  const body = submission()
  const first = await (await postIntake(body)).json<{ lead_id: string }>()

  const corrected = await postIntake({ ...body, submission_key: crypto.randomUUID(), turnstile_token: 'fresh', message: 'Chimney too.' })

  expect(corrected.status).toBe(200)
  expect(await corrected.json()).toMatchObject({ lead_id: first.lead_id })
  expect(await count(`SELECT COUNT(*) AS n FROM form_submissions WHERE raw_body LIKE ?`, `%${body.phone}%`)).toBe(2)
})

it('a retry while the first attempt is still processing is told to wait (202 pending)', async () => {
  const body = submission()
  await postIntake(body)
  await env.DB.prepare(
    `UPDATE submission_processing SET state = 'processing', claimed_until = ?
     WHERE submission_id = (SELECT id FROM form_submissions WHERE submission_key = ?)`,
  )
    .bind(Date.now() + 60_000, body.submission_key)
    .run()

  const retry = await postIntake(body)

  expect(retry.status).toBe(202)
  expect(await retry.json()).toEqual({ ok: true, success: false, pending: true })
})

it('concurrent duplicate submits with one key make one Form submission and one Lead', async () => {
  const body = submission()
  const responses = await Promise.all(Array.from({ length: 5 }, () => postIntake(body)))
  const statuses = responses.map((r) => r.status)
  const bodies = await Promise.all(responses.map((r) => r.json<{ lead_id?: string }>()))

  expect(statuses.every((s) => s === 200 || s === 202)).toBe(true)
  expect(statuses).toContain(200)
  expect(new Set(bodies.filter((b) => b.lead_id).map((b) => b.lead_id)).size).toBe(1)
  expect(await count('SELECT COUNT(*) AS n FROM form_submissions WHERE submission_key = ?', body.submission_key)).toBe(1)
  expect(await count('SELECT COUNT(*) AS n FROM leads WHERE phone = ?', body.phone)).toBe(1)
})

it('concurrent duplicates that all pass the key lookup before any is stored share the one token redemption', async () => {
  vi.restoreAllMocks()
  // Every duplicate reaches siteverify before any of them is stored; only the first redemption succeeds.
  let first = true
  const arrivals: Array<() => void> = []
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (new Request(input, init).url !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return realFetch(input, init)
    await new Promise<void>((resolve) => {
      arrivals.push(resolve)
      if (arrivals.length === 3) arrivals.forEach((r) => r())
    })
    const success = first
    first = false
    return Response.json(success ? { success, hostname: 'example.com', action: '' } : { success, 'error-codes': ['timeout-or-duplicate'] })
  })
  const body = submission()
  // Called in-process: a barrier across separate SELF requests would hang (workerd request contexts).
  const responses = await Promise.all(Array.from({ length: 3 }, () => handleIntake(intakeRequest(body), env)))

  expect(responses.map((r) => r.status).every((s) => s === 200 || s === 202)).toBe(true)
  expect(await count('SELECT COUNT(*) AS n FROM form_submissions WHERE submission_key = ?', body.submission_key)).toBe(1)
})

it('concurrent submits from one Homeowner under different keys make one Lead', async () => {
  const phone = randomPhone()
  const responses = await Promise.all(Array.from({ length: 8 }, () => postIntake(submission({ phone, email: '' }))))
  const bodies = await Promise.all(responses.map((r) => r.json<{ lead_id?: string }>()))

  expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200))
  expect(new Set(bodies.map((b) => b.lead_id)).size).toBe(1)
})

/**
 * D1 whose first `rounds` rounds of batch() calls run in lock-step groups of `n`, so `n` requests interleave
 * deterministically (store+claim, then the Lead write); later batches pass straight through.
 */
function lockStepD1(n: number, rounds = 2): D1Database {
  let round: Array<() => void> = []
  let gated = 0
  const gate = () =>
    new Promise<void>((resolve) => {
      if (gated >= n * rounds) return resolve()
      gated++
      round.push(resolve)
      if (round.length === n) {
        round.forEach((r) => r())
        round = []
      }
    })
  return new Proxy(env.DB, {
    get(target, prop) {
      const value = Reflect.get(target, prop)
      if (prop === 'batch') return async (stmts: D1PreparedStatement[]) => (await gate(), target.batch(stmts))
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

it('two first-time submits from one new Homeowner that race past the Lead lookup still make one Lead', async () => {
  const phone = randomPhone()
  const raceEnv = { ...env, DB: lockStepD1(2) }
  const responses = await Promise.all([
    handleIntake(intakeRequest(submission({ phone, email: '' })), raceEnv),
    handleIntake(intakeRequest(submission({ phone, email: '' })), raceEnv),
  ])
  const bodies = await Promise.all(responses.map((r) => r.json<{ lead_id?: string }>()))

  expect(responses.map((r) => r.status)).toEqual([200, 200])
  expect(bodies[0].lead_id).toBe(bodies[1].lead_id)
  expect(await count('SELECT COUNT(*) AS n FROM leads WHERE phone = ?', phone)).toBe(1)
})

/** D1 whose `n`th batch() call waits until `release()`; `reached` resolves when that call arrives. */
function heldBatchD1(n: number) {
  let calls = 0
  let release!: () => void
  let arrived!: () => void
  const held = new Promise<void>((r) => (release = r))
  const reached = new Promise<void>((r) => (arrived = r))
  const db = new Proxy(env.DB, {
    get(target, prop) {
      const value = Reflect.get(target, prop)
      if (prop === 'batch')
        return async (stmts: D1PreparedStatement[]) => {
          if (++calls === n) {
            arrived()
            await held
          }
          return target.batch(stmts)
        }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { db, reached, release }
}

it('a processor whose claim expired and was replayed meanwhile answers the stored success and never marks it failed', async () => {
  const body = submission({ sms_consent: true })
  // Batch 1 stores + claims; batch 2 (the Lead write) is held while the claim expires and Replay finishes.
  const slow = heldBatchD1(2)
  const original = handleIntake(intakeRequest(body), { ...env, DB: slow.db })
  await slow.reached
  const { id } = (await env.DB.prepare('SELECT id FROM form_submissions WHERE submission_key = ?').bind(body.submission_key).first<{ id: string }>())!
  await env.DB.prepare('UPDATE submission_processing SET claimed_until = ? WHERE submission_id = ?').bind(Date.now() - 1, id).run()
  const replayed = await replayFormSubmission(env.DB, id)
  expect(replayed.status).toBe(200)

  slow.release()
  const late = await original

  expect(late.status).toBe(200)
  expect(await late.json()).toEqual(replayed.body)
  const row = await env.DB.prepare('SELECT state, lead_id FROM submission_processing WHERE submission_id = ?').bind(id).first()
  expect(row).toEqual({ state: 'processed', lead_id: replayed.body.lead_id })
  expect(await count('SELECT COUNT(*) AS n FROM lead_activity WHERE dedupe_key = ?', `form:${id}`)).toBe(1)
  expect(await count('SELECT COUNT(*) AS n FROM consent_events WHERE source_ref = ?', id)).toBe(1)
  // A later retry of the same logical submission still gets the stored success.
  const retry = await postIntake(body)
  expect(retry.status).toBe(200)
  expect(await retry.json()).toEqual(replayed.body)
})
