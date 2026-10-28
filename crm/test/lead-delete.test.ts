import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type LeadFileBucket, type SweepDeps, sweepDeletedLeadPrefixes } from '#/lib/lead-files.server'
import { deleteLead } from '#/lib/leads.functions'
import { deleteLeadRecordingFiles } from '#/lib/leads.server'
import { insertLead, leadRow } from './lead-helpers'
import { callServerFn, signedInStaff } from './staff'

// Delete Lead (plan 006 decision 9): admins only; the Lead's activity and the rest go with it (D1 cascades).

describe('deleting a Lead', () => {
  it('an admin deletes a Lead and its activity goes with it', async () => {
    const { cookie } = await signedInStaff('admin')
    const id = await insertLead()
    await env.DB.prepare(`INSERT INTO lead_activity (id, lead_id, kind, body, created_at) VALUES (?, ?, 'note', 'Called', ?)`)
      .bind(crypto.randomUUID(), id, Date.now())
      .run()

    expect((await callServerFn(deleteLead, cookie, { leadId: id })).status).toBe(200)

    expect(await leadRow(id)).toBeNull()
    expect(await env.DB.prepare('SELECT count(*) AS n FROM lead_activity WHERE lead_id = ?').bind(id).first('n')).toBe(0)
  })

  it('refuses a staff-role Staff member (403) and leaves the Lead', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead()

    expect((await callServerFn(deleteLead, cookie, { leadId: id })).status).toBe(403)
    expect(await leadRow(id)).not.toBeNull()
  })

  it('refuses a caller who is not signed in (401)', async () => {
    const id = await insertLead()

    expect((await callServerFn(deleteLead, undefined, { leadId: id })).status).toBe(401)
  })

  it('says so when the Lead does not exist (404)', async () => {
    const { cookie } = await signedInStaff('admin')

    expect((await callServerFn(deleteLead, cookie, { leadId: crypto.randomUUID() })).status).toBe(404)
  })
})

// Quote files of a deleted Lead (plan 009 decision 15): the delete records the Lead's R2 prefix in the same batch, and
// the `r2-cleanup` cron task sweeps the prefix about 5 minutes, 1 hour and 24 hours later, then drops the record.
const MIN = 60_000
const HOUR = 60 * MIN
const T = 1_800_000_000_000

const prefixOf = (leadId: string) => `leads/${leadId}/`
const records = () =>
  env.DB.prepare('SELECT prefix, sweeps_done, next_sweep_at FROM r2_prefix_deletes ORDER BY next_sweep_at, prefix')
    .all<{ prefix: string; sweeps_done: number; next_sweep_at: number }>()
    .then((r) => r.results)
const recordOf = (leadId: string) =>
  env.DB.prepare('SELECT sweeps_done, next_sweep_at FROM r2_prefix_deletes WHERE prefix = ?').bind(prefixOf(leadId)).first()
const keysUnder = (prefix: string) => env.LEAD_FILES.list({ prefix }).then((l) => l.objects.map((o) => o.key).sort())
const putObject = (key: string) => env.LEAD_FILES.put(key, 'bytes')

async function insertFileRow(leadId: string, fileId: string, removed = false) {
  await env.DB.prepare(
    `INSERT INTO lead_files (id, lead_id, kind, file_name, content_type, size_bytes, r2_key, uploaded_at, removed_at, removed_reason)
     VALUES (?, ?, 'signed_quote', 'Signed.pdf', 'application/pdf', 5, ?, ?, ?, ?)`,
  )
    .bind(fileId, leadId, `${prefixOf(leadId)}${fileId}`, T, removed ? T : null, removed ? 'removed' : null)
    .run()
}

/** A bucket that records list/delete calls and can be made to fail. */
function sweepBucket(fail: { list?: (prefix: string) => boolean; delete?: () => boolean } = {}) {
  const lists: { prefix?: string; cursor?: string; limit?: number }[] = []
  const deletes: string[][] = []
  const bucket = {
    list: async (options?: R2ListOptions) => {
      lists.push({ prefix: options?.prefix, cursor: options?.cursor, limit: options?.limit })
      if (fail.list?.(options?.prefix ?? '')) throw new Error('R2 list failed')
      return env.LEAD_FILES.list(options)
    },
    delete: async (keys: string | string[]) => {
      const all = Array.isArray(keys) ? keys : [keys]
      deletes.push(all)
      if (fail.delete?.()) throw new Error('R2 delete failed')
      return env.LEAD_FILES.delete(all)
    },
  } as unknown as LeadFileBucket
  return { bucket, lists, deletes }
}

describe('deleting a Lead records its R2 prefix', () => {
  it('one record (leads/<id>/, 0 sweeps, due in 5 minutes) in the same batch as the delete', async () => {
    const id = await insertLead()
    await insertFileRow(id, crypto.randomUUID())

    expect(await deleteLeadRecordingFiles(env.DB, id, T)).toBe(true)

    expect(await leadRow(id)).toBeNull()
    expect(await env.DB.prepare('SELECT count(*) AS n FROM lead_files WHERE lead_id = ?').bind(id).first('n')).toBe(0)
    expect(await recordOf(id)).toEqual({ sweeps_done: 0, next_sweep_at: T + 5 * MIN })
  })

  it('a Lead with no files still gets one (an upload may be in flight), also through deleteLead', async () => {
    const { cookie } = await signedInStaff('admin')
    const id = await insertLead()
    const before = Date.now()

    expect((await callServerFn(deleteLead, cookie, { leadId: id })).status).toBe(200)

    const record = await recordOf(id)
    expect(record).toMatchObject({ sweeps_done: 0 })
    expect(record!.next_sweep_at).toBeGreaterThanOrEqual(before + 5 * MIN)
  })

  it('an unknown id -> 404 and no record', async () => {
    const { cookie } = await signedInStaff('admin')
    const id = crypto.randomUUID()
    const count = (await records()).length

    expect((await callServerFn(deleteLead, cookie, { leadId: id })).status).toBe(404)
    expect(await deleteLeadRecordingFiles(env.DB, id, T)).toBe(false)

    expect(await recordOf(id)).toBeNull()
    expect(await records()).toHaveLength(count)
  })
})

describe('r2-cleanup sweeps a deleted Lead prefix', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM r2_prefix_deletes')
  })

  const sweep = (now: number, deps: Omit<SweepDeps, 'now'> = {}) => sweepDeletedLeadPrefixes(env, { now: () => now, ...deps })

  it('removes a current, a removed and an orphaned object once due, and leaves another Lead alone', async () => {
    const id = await insertLead()
    const other = await insertLead()
    const [current, removed, orphan] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    await insertFileRow(id, current)
    await insertFileRow(id, removed, true)
    for (const f of [current, removed, orphan]) await putObject(`${prefixOf(id)}${f}`)
    await putObject(`${prefixOf(other)}kept`)
    await deleteLeadRecordingFiles(env.DB, id, T)

    await sweep(T + 4 * MIN)
    expect(await keysUnder(prefixOf(id))).toHaveLength(3)
    expect(await recordOf(id)).toEqual({ sweeps_done: 0, next_sweep_at: T + 5 * MIN })

    await sweep(T + 5 * MIN)
    expect(await keysUnder(prefixOf(id))).toEqual([])
    expect(await keysUnder(prefixOf(other))).toEqual([`${prefixOf(other)}kept`])
    expect(await recordOf(id)).toEqual({ sweeps_done: 1, next_sweep_at: T + 60 * MIN })
  })

  it('an object that lands after an empty first sweep (a late put) goes in the second', async () => {
    const id = await insertLead()
    await deleteLeadRecordingFiles(env.DB, id, T)

    await sweep(T + 5 * MIN)
    await putObject(`${prefixOf(id)}late-upload`)
    await sweep(T + 60 * MIN)

    expect(await keysUnder(prefixOf(id))).toEqual([])
    expect(await recordOf(id)).toMatchObject({ sweeps_done: 2 })
  })

  it('lifecycle: 0 -> 1 -> 2 at +55 min then +23 h, nothing before it is due, the third sweep drops the record', async () => {
    const id = await insertLead()
    await deleteLeadRecordingFiles(env.DB, id, T)
    const s1 = T + 5 * MIN

    await sweep(s1)
    expect(await recordOf(id)).toEqual({ sweeps_done: 1, next_sweep_at: s1 + 55 * MIN })
    await sweep(s1 + 54 * MIN)
    expect(await recordOf(id)).toEqual({ sweeps_done: 1, next_sweep_at: s1 + 55 * MIN })

    const s2 = s1 + 55 * MIN
    await sweep(s2)
    expect(await recordOf(id)).toEqual({ sweeps_done: 2, next_sweep_at: s2 + 23 * HOUR })
    await sweep(s2 + 22 * HOUR)
    expect(await recordOf(id)).toMatchObject({ sweeps_done: 2 })

    await sweep(s2 + 23 * HOUR)
    expect(await recordOf(id)).toBeNull()
  })

  it('a failed list, then a failed delete, leave the record due (logged); the next run sweeps it; one failing prefix does not stop another', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [a, b] = [await insertLead(), await insertLead()]
    await putObject(`${prefixOf(a)}x`)
    await putObject(`${prefixOf(b)}y`)
    await deleteLeadRecordingFiles(env.DB, a, T)
    await deleteLeadRecordingFiles(env.DB, b, T + 1)
    const due = T + 10 * MIN

    await sweep(due, { bucket: sweepBucket({ list: (p) => p === prefixOf(a) }).bucket })
    expect(await recordOf(a)).toEqual({ sweeps_done: 0, next_sweep_at: T + 5 * MIN })
    expect(await recordOf(b)).toMatchObject({ sweeps_done: 1 })
    expect(await keysUnder(prefixOf(b))).toEqual([])

    await sweep(due, { bucket: sweepBucket({ delete: () => true }).bucket })
    expect(await recordOf(a)).toEqual({ sweeps_done: 0, next_sweep_at: T + 5 * MIN })
    expect(await keysUnder(prefixOf(a))).toEqual([`${prefixOf(a)}x`])

    await sweep(due)
    expect(await keysUnder(prefixOf(a))).toEqual([])
    expect(await recordOf(a)).toMatchObject({ sweeps_done: 1 })
    const lines = error.mock.calls.map((c) => JSON.parse(String(c[0])))
    expect(lines).toEqual([
      expect.objectContaining({ level: 'error', msg: 'r2-cleanup sweep failed', prefix: prefixOf(a), error: expect.stringContaining('R2 list failed') }),
      expect.objectContaining({ level: 'error', msg: 'r2-cleanup sweep failed', prefix: prefixOf(a), error: expect.stringContaining('R2 delete failed') }),
    ])
    error.mockRestore()
  })

  it('follows the list cursor page by page; a page cap carries the prefix over to later runs before the sweep counts', async () => {
    const id = await insertLead()
    const keys = ['a', 'b', 'c', 'd', 'e'].map((k) => `${prefixOf(id)}${k}`)
    for (const k of keys) await putObject(k)
    await deleteLeadRecordingFiles(env.DB, id, T)
    const due = T + 5 * MIN

    const paged = sweepBucket()
    await sweep(due, { bucket: paged.bucket, pageSize: 2 })
    expect(paged.lists).toHaveLength(3)
    expect(paged.lists[0]).toEqual({ prefix: prefixOf(id), cursor: undefined, limit: 2 })
    expect(paged.lists[1].cursor).toEqual(expect.any(String))
    expect(paged.lists[2].cursor).toEqual(expect.any(String))
    expect(paged.deletes.flat().sort()).toEqual(keys)
    expect(await recordOf(id)).toMatchObject({ sweeps_done: 1 })

    const later = await insertLead()
    for (const k of ['a', 'b', 'c', 'd', 'e']) await putObject(`${prefixOf(later)}${k}`)
    await deleteLeadRecordingFiles(env.DB, later, T)
    const capped = { bucket: sweepBucket().bucket, pageSize: 2, pageCap: 1 }
    await sweep(due, capped)
    expect(await keysUnder(prefixOf(later))).toHaveLength(3)
    expect(await recordOf(later)).toEqual({ sweeps_done: 0, next_sweep_at: T + 5 * MIN })
    await sweep(due + 5 * MIN, capped)
    expect(await keysUnder(prefixOf(later))).toHaveLength(1)
    expect(await recordOf(later)).toMatchObject({ sweeps_done: 0 })
    await sweep(due + 10 * MIN, capped)
    expect(await keysUnder(prefixOf(later))).toEqual([])
    expect(await recordOf(later)).toMatchObject({ sweeps_done: 1 })
  })

  it('at most 5 due records per run, oldest due first', async () => {
    const ids: string[] = []
    for (let i = 0; i < 7; i++) {
      const id = await insertLead()
      ids.push(id)
      await deleteLeadRecordingFiles(env.DB, id, T + i * 1000)
    }
    const now = T + HOUR

    await sweep(now)
    expect(await Promise.all(ids.map(async (id) => (await recordOf(id))?.sweeps_done))).toEqual([1, 1, 1, 1, 1, 0, 0])
    await sweep(now)
    expect(await Promise.all(ids.map(async (id) => (await recordOf(id))?.sweeps_done))).toEqual([1, 1, 1, 1, 1, 1, 1])
  })

  it.each(['leads/', '', 'leads/a/b/'])('a record with the prefix %j is deleted and never listed', async (prefix) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await env.DB.prepare('INSERT INTO r2_prefix_deletes (prefix, next_sweep_at) VALUES (?, ?)').bind(prefix, T).run()
    const { bucket, lists } = sweepBucket()

    await sweep(T + HOUR, { bucket })

    expect(lists).toEqual([])
    expect(await records()).toEqual([])
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ level: 'error', msg: 'r2-cleanup record with a bad prefix deleted', prefix })
    error.mockRestore()
  })

  it('two overlapping runs on the same due record count one sweep', async () => {
    const id = await insertLead()
    await deleteLeadRecordingFiles(env.DB, id, T)

    await Promise.all([sweep(T + 5 * MIN), sweep(T + 5 * MIN)])

    expect(await recordOf(id)).toMatchObject({ sweeps_done: 1 })
  })
})
