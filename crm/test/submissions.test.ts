import { SELF, env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listSubmissions, replaySubmission } from '#/lib/submissions.functions'
import { mockSiteverify, postIntake, inspectionFormPayload, randomPhone } from './intake-helpers'
import { BASE, callServerFn, signedInStaff } from './staff'

// PLAN.md > Intake contract: rejected or failed Form submissions appear in an admin Submissions screen with an
// idempotent Replay button.

beforeEach(() => {
  mockSiteverify()
})
afterEach(() => vi.restoreAllMocks())

/** A Form submission whose first Intake attempt died (e.g. a D1 error), as left in the database. */
async function failedSubmission(fields: Record<string, unknown> = {}) {
  const id = crypto.randomUUID()
  const phone = randomPhone()
  const raw = JSON.stringify(inspectionFormPayload({ phone, email: '', ...fields }))
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO form_submissions (id, submission_key, fingerprint, received_at, schema_version, source, raw_body)
       VALUES (?, ?, 'fp', ?, 1, 'quote', ?)`,
    ).bind(id, crypto.randomUUID(), 1_790_000_000_000, raw),
    env.DB.prepare(`INSERT INTO submission_processing (submission_id, state, error, attempts) VALUES (?, 'failed', 'D1_ERROR: boom', 1)`).bind(id),
  ])
  return { id, phone }
}

const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n

describe.each([
  ['listSubmissions', listSubmissions, undefined],
  ['replaySubmission', replaySubmission, { submissionId: 'none' }],
] as const)('%s is admin only', (_name, fn, data) => {
  it('rejects a caller with no session', async () => {
    expect((await callServerFn(fn, undefined, data)).status).toBe(401)
  })

  it('rejects a staff-role Staff member', async () => {
    const { cookie } = await signedInStaff('staff')
    expect((await callServerFn(fn, cookie, data)).status).toBe(403)
  })
})

it('an admin replays a failed Form submission into a Lead, at its original received time', async () => {
  const { cookie } = await signedInStaff('admin')
  const { id, phone } = await failedSubmission({ sms_consent: true })

  const res = await callServerFn(replaySubmission, cookie, { submissionId: id })

  expect(res.status).toBe(200)
  const row = await env.DB.prepare(`SELECT state, lead_id FROM submission_processing WHERE submission_id = ?`).bind(id).first<{ state: string; lead_id: string }>()
  expect(row?.state).toBe('processed')
  expect(await count('SELECT COUNT(*) AS n FROM leads WHERE id = ? AND phone = ?', row?.lead_id, phone)).toBe(1)
  const consent = await env.DB.prepare('SELECT occurred_at FROM consent_events WHERE source_ref = ?').bind(id).first()
  expect(consent).toEqual({ occurred_at: 1_790_000_000_000 })
})

it('replaying twice changes nothing the second time', async () => {
  const { cookie } = await signedInStaff('admin')
  const { id } = await failedSubmission()

  await callServerFn(replaySubmission, cookie, { submissionId: id })
  const again = await callServerFn(replaySubmission, cookie, { submissionId: id })

  expect(again.status).toBe(200)
  expect(await count(`SELECT COUNT(*) AS n FROM lead_activity WHERE dedupe_key = ?`, `form:${id}`)).toBe(1)
  expect(await count(`SELECT COUNT(*) AS n FROM notification_jobs WHERE dedupe_key = ?`, `owner_alert:${id}`)).toBe(1)
  expect(await count(`SELECT attempts AS n FROM submission_processing WHERE submission_id = ?`, id)).toBe(2)
})

it('replaying a rejected submission runs Intake again (after a mapping fix it can become a Lead)', async () => {
  const { cookie } = await signedInStaff('admin')
  const phone = randomPhone()
  const key = crypto.randomUUID()
  await postIntake(inspectionFormPayload({ submission_key: key, name: '', phone, email: '' }))
  const { id } = (await env.DB.prepare('SELECT id FROM form_submissions WHERE submission_key = ?').bind(key).first<{ id: string }>())!

  const res = await callServerFn(replaySubmission, cookie, { submissionId: id })

  expect(res.status).toBe(200)
  // Still no name: rejected again, attempt counted, no Lead.
  const row = await env.DB.prepare('SELECT state, attempts FROM submission_processing WHERE submission_id = ?').bind(id).first()
  expect(row).toEqual({ state: 'rejected', attempts: 2 })
})

it('the Submissions page shows an admin the rejected and failed submissions', async () => {
  const { cookie } = await signedInStaff('admin')
  await failedSubmission({ name: 'Failed Fiona' })

  const res = await SELF.fetch(`${BASE}/submissions`, { headers: { cookie } })

  expect(res.status).toBe(200)
  const html = await res.text()
  expect(html).toContain('Failed Fiona')
  expect(html).toContain('failed')
  expect(html).toContain('Replay')
})

it('the Submissions page tells a staff-role Staff member it is for admins', async () => {
  const { cookie } = await signedInStaff('staff')

  const res = await SELF.fetch(`${BASE}/submissions`, { headers: { cookie } })

  expect(await res.text()).toContain('Only admins')
})

/** `n` processed Form submissions received after `after` (ms), as Intake leaves them. */
async function processedSubmissions(n: number, after: number) {
  const stmts = Array.from({ length: n }, (_, i) => {
    const id = crypto.randomUUID()
    const raw = JSON.stringify(inspectionFormPayload({ name: `Done ${i}`, phone: randomPhone(), email: '' }))
    return [
      env.DB.prepare(
        `INSERT INTO form_submissions (id, submission_key, fingerprint, received_at, schema_version, source, raw_body)
         VALUES (?, ?, 'fp', ?, 1, 'quote', ?)`,
      ).bind(id, crypto.randomUUID(), after + 1 + i, raw),
      env.DB.prepare(`INSERT INTO submission_processing (submission_id, state, attempts) VALUES (?, 'processed', 1)`).bind(id),
    ]
  })
  await env.DB.batch(stmts.flat())
}

it('an old failed submission stays on the Submissions page after 250 newer processed ones', async () => {
  const { cookie } = await signedInStaff('admin')
  await failedSubmission({ name: 'Old Olive' })
  await processedSubmissions(250, 1_790_000_000_000)

  const html = await (await SELF.fetch(`${BASE}/submissions`, { headers: { cookie } })).text()

  expect(html).toContain('Old Olive')
  expect(html).toContain('Replay')
  expect(html).not.toContain('Done 249')
})

it('a submission stuck in processing past its claim is listed as needing attention', async () => {
  const { cookie } = await signedInStaff('admin')
  const { id } = await failedSubmission({ name: 'Stuck Stella' })
  await env.DB.prepare(`UPDATE submission_processing SET state = 'processing', claimed_until = ? WHERE submission_id = ?`).bind(Date.now() - 1, id).run()

  const html = await (await SELF.fetch(`${BASE}/submissions`, { headers: { cookie } })).text()

  expect(html).toContain('Stuck Stella')
})

it('the all-submissions view pages back to the oldest Form submission', async () => {
  const { cookie } = await signedInStaff('admin')
  await failedSubmission({ name: 'Old Olive' })
  await processedSubmissions(250, 1_790_000_000_000)

  let url = `${BASE}/submissions?view=all`
  const seen: string[] = []
  for (let page = 0; page < 10; page++) {
    const html = await (await SELF.fetch(url, { headers: { cookie } })).text()
    seen.push(html)
    if (html.includes('Old Olive')) break
    const older = html.match(/href="([^"]*before=[^"]*)"[^>]*>Older/)
    if (!older) break
    url = `${BASE}${older[1].replaceAll('&amp;', '&')}`
  }

  expect(seen.length).toBeGreaterThan(1)
  expect(seen.at(-1)).toContain('Old Olive')
  expect(seen[0]).toContain('Done 249')
})
