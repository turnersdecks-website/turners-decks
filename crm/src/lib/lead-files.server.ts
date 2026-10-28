import type { LeadFileType } from '#/db/schema'
import { type AuthEnv, createAuth } from '#/lib/auth'
import { LEAD_FILE_MAX_BYTES, SNIFF_PREFIX_BYTES, contentDisposition, isLeadFileKind, safeFileName, sniffFileType } from '#/lib/lead-files'
import { isSameOrigin } from '#/lib/same-origin'

// Quote files (plan 009 decisions 10-15): upload and download for the /api/lead-files routes, and the `r2-cleanup`
// cron task that empties a deleted Lead's R2 prefix.
//
// The upload path never deletes an R2 object. It writes the object under a fresh key (`leads/<leadId>/<fileId>`, never
// reused) first and the D1 row second. If anything fails after the `put` starts, the object stays: unreferenced, it is
// an orphan, never served (downloads go through D1 rows) and removed when its Lead is deleted (the whole prefix is
// swept). Nothing is buffered beyond the first chunks that make up the 4 KiB prefix used to recognise the file type.

export type LeadFilesEnv = AuthEnv & Pick<Env, 'LEAD_FILES'>
export type LeadFileBucket = Pick<R2Bucket, 'put' | 'get' | 'list' | 'delete'>

/** Test seams: a bucket or D1 wrapper (e.g. one whose `batch` commits then throws), a hook after the `put`, a clock. */
export type LeadFilesDeps = {
  bucket?: LeadFileBucket
  d1?: Pick<D1Database, 'prepare' | 'batch'>
  afterPut?: (file: { leadId: string; fileId: string; key: string }) => Promise<void>
  now?: () => number
}

/** Every object of a Lead lives under this prefix, so Lead delete can sweep them all (decision 15). */
export const leadFilePrefix = (leadId: string) => `leads/${leadId}/`

export const UPLOAD_MESSAGES = {
  cutOff: 'The upload was cut off. Try again.',
  tooBig: 'Files can be up to 25 MB.',
  badType: 'Upload a PDF, JPG, PNG or HEIC.',
  stale: 'This file was already replaced or removed. Reload.',
  changed: 'Someone else just changed this file. Reload.',
  storeFailed: 'Upload failed. Try again.',
  uncertain: 'The upload may not have saved. Reload to check.',
} as const

const text = (body: string, status: number) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

const INSERT_COLUMNS = 'id, lead_id, kind, file_name, content_type, size_bytes, r2_key, uploaded_by, uploaded_at'

/**
 * `POST /api/lead-files?lead=<id>&kind=<kind>`: the body is the file's bytes. Headers: `content-length`, `x-file-name`
 * (URI-encoded) and `x-replace: <fileId>` when replacing. 201 with the new row as JSON.
 */
export async function handleUpload(request: Request, env: LeadFilesEnv, deps: LeadFilesDeps = {}): Promise<Response> {
  // 1. Session first (route policy expects 401 before anything else), 2. same origin.
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session) return text('Unauthorized', 401)
  if (!isSameOrigin(request)) return text('Cross-site request refused.', 403)

  const d1 = deps.d1 ?? env.DB
  const bucket = deps.bucket ?? env.LEAD_FILES
  const now = deps.now ?? Date.now

  // 3. Slot and Lead.
  const q = new URL(request.url).searchParams
  const kind = q.get('kind')
  const leadId = q.get('lead')
  if (!isLeadFileKind(kind)) return text('Unknown file slot.', 400)
  if (!leadId || leadId.length > 100 || !(await d1.prepare('SELECT 1 FROM leads WHERE id = ?').bind(leadId).first())) {
    return text('Lead not found', 404)
  }

  // 4. The declared length is the contract for the rest of the request.
  const declared = request.headers.get('content-length')
  if (!declared || !/^\d+$/.test(declared)) return text('Content-Length required.', 411)
  const n = Number(declared)
  if (n < 1) return text('The file is empty.', 400)
  if (n > LEAD_FILE_MAX_BYTES) return text(UPLOAD_MESSAGES.tooBig, 413)

  // 5. Fast fail on a stale replace, before any bytes go to R2 (the real guard is the batch below).
  const replace = request.headers.get('x-replace')
  if (replace !== null) {
    const current =
      replace.length > 0 &&
      replace.length <= 100 &&
      (await d1
        .prepare('SELECT 1 FROM lead_files WHERE id = ? AND lead_id = ? AND kind = ? AND removed_at IS NULL')
        .bind(replace, leadId, kind)
        .first())
    if (!current) return text(UPLOAD_MESSAGES.stale, 409)
  }

  // 6. The prefix: chunks until min(4096, n) bytes are held or the body ends.
  if (!request.body) return text(UPLOAD_MESSAGES.cutOff, 400)
  const reader = request.body.getReader()
  const cancel = (reason?: unknown) => reader.cancel(reason).catch(() => {})
  const held: Uint8Array[] = []
  let seen = 0
  const want = Math.min(SNIFF_PREFIX_BYTES, n)
  try {
    while (seen < want) {
      const { done, value } = await reader.read()
      if (done) break
      held.push(value)
      seen += value.byteLength
    }
  } catch {
    await cancel()
    return text(UPLOAD_MESSAGES.cutOff, 400)
  }
  if (seen > n) {
    await cancel()
    return text(UPLOAD_MESSAGES.tooBig, 413)
  }
  if (seen < want) return text(UPLOAD_MESSAGES.cutOff, 400)

  // 7. The type comes from the bytes; the client's content-type is ignored.
  const type = sniffFileType(concat(held, SNIFF_PREFIX_BYTES))
  if (!type) {
    await cancel()
    return text(UPLOAD_MESSAGES.badType, 415)
  }
  const fileName = safeFileName(decodeName(request.headers.get('x-file-name')), type, kind)

  // 8. Stream to R2 under a fresh key. FixedLengthStream gives R2 the length it needs and errors on a short or long
  // body; the counting source below errors first so the reason is known. Both sides are settled before replying.
  const fileId = crypto.randomUUID()
  const key = `${leadFilePrefix(leadId)}${fileId}`
  let failure: 'overflow' | 'cutOff' | null = null
  const source = new ReadableStream<Uint8Array>(
    {
      start(c) {
        for (const chunk of held) c.enqueue(chunk)
        held.length = 0
      },
      async pull(c) {
        let next: ReadableStreamReadResult<Uint8Array>
        try {
          next = await reader.read()
        } catch (err) {
          failure ??= 'cutOff' // the client went away or the body errored
          throw err
        }
        if (next.done) {
          if (seen < n) {
            failure ??= 'cutOff'
            c.error(new Error('body shorter than Content-Length'))
          } else c.close()
          return
        }
        seen += next.value.byteLength
        if (seen > n) {
          failure ??= 'overflow'
          c.error(new Error('body longer than Content-Length'))
          await cancel()
          return
        }
        c.enqueue(next.value)
      },
      cancel: (reason) => cancel(reason),
    },
    { highWaterMark: 0 },
  )
  const fixed = new FixedLengthStream(n)
  const abort = new AbortController()
  const pipe = source.pipeTo(fixed.writable, { signal: abort.signal })
  const put = Promise.resolve().then(() => bucket.put(key, fixed.readable, { httpMetadata: { contentType: type } }))
  put.catch((err) => {
    abort.abort(err)
    void cancel(err)
  })
  const [piped, stored] = await Promise.allSettled([pipe, put])
  if (piped.status === 'rejected' || stored.status === 'rejected') {
    if (failure === 'overflow') return text(UPLOAD_MESSAGES.tooBig, 413)
    if (failure === 'cutOff') return text(UPLOAD_MESSAGES.cutOff, 400)
    log({ msg: 'quote file put failed', leadId, kind, error: errorText(stored.status === 'rejected' ? stored.reason : (piped as PromiseRejectedResult).reason) })
    return text(UPLOAD_MESSAGES.storeFailed, 503)
  }
  await deps.afterPut?.({ leadId, fileId, key })

  // 9. One batch, all or nothing. A replace retires the target, then inserts the new row with uploaded_at NULL (which
  // fails NOT NULL and rolls the batch back) unless this batch's update retired it (decision 13).
  const at = now()
  const staffId = session.user.id
  const values = [fileId, leadId, kind, fileName, type, n, key, staffId] as const
  const statements =
    replace === null
      ? [d1.prepare(`INSERT INTO lead_files (${INSERT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...values, at)]
      : [
          d1
            .prepare(
              `UPDATE lead_files SET removed_at = ?, removed_by = ?, removed_reason = 'replaced', replaced_by_id = ?
               WHERE id = ? AND lead_id = ? AND kind = ? AND removed_at IS NULL`,
            )
            .bind(at, staffId, fileId, replace, leadId, kind),
          d1
            .prepare(
              `INSERT INTO lead_files (${INSERT_COLUMNS})
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN EXISTS (SELECT 1 FROM lead_files WHERE id = ? AND replaced_by_id = ?) THEN ? END`,
            )
            .bind(...values, replace, fileId, at),
        ]
  try {
    await d1.batch(statements)
  } catch (err) {
    // 10. The new object stays in every case: an orphan if the batch rolled back, the live file if it committed.
    const message = errorText(err)
    if (message.includes('UNIQUE constraint failed: lead_files.lead_id, lead_files.kind')) return text(UPLOAD_MESSAGES.changed, 409)
    if (message.includes('NOT NULL constraint failed: lead_files.uploaded_at')) return text(UPLOAD_MESSAGES.stale, 409)
    if (message.includes('FOREIGN KEY constraint failed')) return text('Lead not found', 404)
    log({ msg: 'quote file row not saved', leadId, kind, fileId, error: message })
    return text(UPLOAD_MESSAGES.uncertain, 500)
  }

  // 11.
  return Response.json(
    { id: fileId, leadId, kind, fileName, contentType: type, sizeBytes: n, uploadedBy: staffId, uploadedAt: at },
    { status: 201 },
  )
}

const INLINE_TYPES = new Set<LeadFileType>(['application/pdf', 'image/jpeg', 'image/png'])

/**
 * `GET /api/lead-files/<id>`: the file's bytes, streamed from R2, for a signed-in Staff member. Removed files stay
 * downloadable by id. `?download=1` (and every HEIC) is sent as an attachment. No public or signed URLs exist.
 */
export async function handleDownload(request: Request, env: LeadFilesEnv, fileId: string, deps: LeadFilesDeps = {}): Promise<Response> {
  // Session before any lookup, so a real id and an unknown one look the same to a signed-out caller.
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session) return text('Unauthorized', 401)
  const d1 = deps.d1 ?? env.DB
  const bucket = deps.bucket ?? env.LEAD_FILES
  const row =
    fileId && fileId.length <= 100
      ? await d1
          .prepare('SELECT r2_key, file_name, content_type, size_bytes FROM lead_files WHERE id = ?')
          .bind(fileId)
          .first<{ r2_key: string; file_name: string; content_type: LeadFileType; size_bytes: number }>()
      : null
  if (!row) return text('File not found', 404)
  let object: R2ObjectBody | null
  try {
    object = await bucket.get(row.r2_key)
  } catch (err) {
    log({ msg: 'quote file get failed', fileId, error: errorText(err) })
    return text('The file could not be loaded. Try again.', 503)
  }
  if (!object) return text('File not found', 404)

  const attachment = new URL(request.url).searchParams.get('download') === '1' || !INLINE_TYPES.has(row.content_type)
  const headers = new Headers({
    'content-type': row.content_type,
    'content-length': String(row.size_bytes),
    'content-disposition': contentDisposition(attachment ? 'attachment' : 'inline', row.file_name),
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, no-store',
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
  })
  // A CSP sandbox breaks Chrome's PDF viewer, so only images get it.
  if (row.content_type !== 'application/pdf') {
    headers.set('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
  }
  return new Response(object.body, { headers })
}

// ---------------------------------------------------------------------------
// r2-cleanup (decision 15): each deleted Lead's prefix is swept about 5 minutes, 1 hour and 24 hours after the delete,
// then its record goes. An upload racing the delete can still land an object after an empty sweep, so one sweep proves
// nothing; three spread over a day cover any plausible in-flight 25 MB put.

export const SWEEP_RECORDS_PER_RUN = 5
export const SWEEP_PAGE_SIZE = 1000 // R2's list page and bulk-delete maximum
export const SWEEP_PAGES_PER_RECORD = 3
const MIN = 60_000
/** After sweep 1 (about 5 minutes after the delete): sweep 2 about 1 hour after it, then sweep 3 about 24 hours after. */
const NEXT_SWEEP_AFTER = [55 * MIN, 23 * 60 * MIN]
const PREFIX_RE = /^leads\/[A-Za-z0-9-]+\/$/

export type SweepEnv = { DB: D1Database; LEAD_FILES: R2Bucket }
export type SweepDeps = { bucket?: LeadFileBucket; now?: () => number; pageSize?: number; pageCap?: number }

/**
 * Sweeps up to 5 due prefixes, each on its own (one failing never stops the others). A finished listing counts as a
 * sweep; a page cap that is still `truncated`, or any failed `list`/`delete` (logged), leaves the record unchanged and
 * due, so the next run (5 minutes later) lists from the start again: the objects already listed are gone.
 */
export async function sweepDeletedLeadPrefixes(env: SweepEnv, deps: SweepDeps = {}): Promise<void> {
  const now = deps.now?.() ?? Date.now()
  const { results } = await env.DB.prepare(
    'SELECT prefix, sweeps_done FROM r2_prefix_deletes WHERE next_sweep_at <= ? ORDER BY next_sweep_at, prefix LIMIT ?',
  )
    .bind(now, SWEEP_RECORDS_PER_RUN)
    .all<{ prefix: string; sweeps_done: number }>()
  for (const record of results) {
    try {
      await sweepPrefix(env, deps, record, now)
    } catch (err) {
      log({ msg: 'r2-cleanup sweep failed', prefix: record.prefix, error: errorText(err) })
    }
  }
}

async function sweepPrefix(env: SweepEnv, deps: SweepDeps, { prefix, sweeps_done: seen }: { prefix: string; sweeps_done: number }, now: number) {
  // Only a bug could write anything but `leads/<id>/`; never list the bucket root or all of `leads/`.
  if (!PREFIX_RE.test(prefix)) {
    log({ msg: 'r2-cleanup record with a bad prefix deleted', prefix })
    await env.DB.prepare('DELETE FROM r2_prefix_deletes WHERE prefix = ?').bind(prefix).run()
    return
  }
  const bucket = deps.bucket ?? env.LEAD_FILES
  const pageSize = deps.pageSize ?? SWEEP_PAGE_SIZE
  const pageCap = deps.pageCap ?? SWEEP_PAGES_PER_RECORD
  let cursor: string | undefined
  for (let page = 0; page < pageCap; page++) {
    const listed = await bucket.list({ prefix, limit: pageSize, cursor })
    const keys = listed.objects.map((o) => o.key)
    if (keys.length) await bucket.delete(keys)
    if (!listed.truncated) return finishSweep(env.DB, prefix, seen, now)
    cursor = listed.cursor
  }
  // Page cap hit: still truncated, so this sweep has not finished; the record stays due.
}

/** The `sweeps_done = :seen` guard makes two overlapping runs count one sweep. */
async function finishSweep(d1: D1Database, prefix: string, seen: number, now: number) {
  if (seen >= NEXT_SWEEP_AFTER.length) {
    await d1.prepare('DELETE FROM r2_prefix_deletes WHERE prefix = ? AND sweeps_done = ?').bind(prefix, seen).run()
    return
  }
  await d1
    .prepare('UPDATE r2_prefix_deletes SET sweeps_done = sweeps_done + 1, next_sweep_at = ? WHERE prefix = ? AND sweeps_done = ?')
    .bind(now + NEXT_SWEEP_AFTER[seen], prefix, seen)
    .run()
}

function concat(chunks: Uint8Array[], max: number): Uint8Array {
  const out = new Uint8Array(Math.min(max, chunks.reduce((n, c) => n + c.byteLength, 0)))
  let at = 0
  for (const c of chunks) {
    if (at >= out.length) break
    const part = c.subarray(0, out.length - at)
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

function decodeName(value: string | null): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function errorText(err: unknown): string {
  const cause = err instanceof Error && err.cause ? ` ${String(err.cause)}` : ''
  return `${err instanceof Error ? err.message : String(err)}${cause}`.slice(0, 500)
}

function log(fields: Record<string, unknown>) {
  console.error(JSON.stringify({ level: 'error', ...fields }))
}
