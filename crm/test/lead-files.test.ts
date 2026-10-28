import { SELF, env } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { listLeadFiles, removeLeadFile } from '#/lib/lead-files.functions'
import { type LeadFileBucket, type LeadFilesDeps, UPLOAD_MESSAGES, handleDownload, handleUpload } from '#/lib/lead-files.server'
import { deleteLeadRecordingFiles } from '#/lib/leads.server'
import { insertLead } from './lead-helpers'
import { BASE, callServerFn, serverFnResult, signedInStaff } from './staff'

// Quote files (plan 009 decisions 7-16): the upload and download routes and the list/remove server functions, on the
// real migrated D1 and Miniflare's R2 (env.LEAD_FILES). Direct handleUpload calls are used where a hand-built Request
// (a lying Content-Length, a stream that errors) or a seam (bucket/D1 wrapper, afterPut) is needed.

const MAX = 26_214_400
const enc = new TextEncoder()

/** `n` bytes that sniff as a PDF. */
function pdf(n: number): Uint8Array {
  const bytes = new Uint8Array(n).fill(0x20)
  bytes.set(enc.encode('%PDF-1.7\n').subarray(0, n))
  return bytes
}
const png = (n = 64) => {
  const bytes = new Uint8Array(n)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return bytes
}
/** An HEIC header (ftyp: major heic, compatible mif1 + heic) and padding. */
const heic = (n = 128) => {
  const bytes = new Uint8Array(n)
  bytes.set([0, 0, 0, 24, ...enc.encode('ftypheic'), 0, 0, 0, 0, ...enc.encode('mif1heic')])
  return bytes
}

const uploadUrl = (leadId: string, kind: string) => `${BASE}/api/lead-files?lead=${encodeURIComponent(leadId)}&kind=${kind}`

/** An upload the way the Quote tab sends it (same origin, file bytes as the body; the runtime sets Content-Length). */
function upload(cookie: string | undefined, leadId: string, kind: string, body: Uint8Array, headers: Record<string, string> = {}) {
  return SELF.fetch(uploadUrl(leadId, kind), {
    method: 'POST',
    headers: {
      'sec-fetch-site': 'same-origin',
      origin: BASE,
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent('Smith quote.pdf'),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body,
  })
}

const download = (cookie: string | undefined, id: string, query = '') =>
  SELF.fetch(`${BASE}/api/lead-files/${id}${query}`, { headers: cookie ? { cookie } : {} })

type FileRow = {
  id: string
  lead_id: string
  kind: string
  file_name: string
  content_type: string
  size_bytes: number
  r2_key: string
  uploaded_by: string | null
  removed_at: number | null
  removed_reason: string | null
  replaced_by_id: string | null
}
const rowsOf = (leadId: string) =>
  env.DB.prepare('SELECT * FROM lead_files WHERE lead_id = ? ORDER BY uploaded_at, rowid')
    .bind(leadId)
    .all<FileRow>()
    .then((r) => r.results)
const rowById = (id: string) => env.DB.prepare('SELECT * FROM lead_files WHERE id = ?').bind(id).first<FileRow>()
const objectsUnder = (leadId: string) => env.LEAD_FILES.list({ prefix: `leads/${leadId}/` }).then((l) => l.objects.map((o) => o.key))

// Every bucket handed to handleUpload records its calls; the upload path must never delete an object (decision 12).
let deleteCalls = 0
afterEach(() => {
  expect(deleteCalls, 'the upload path called R2 delete').toBe(0)
  deleteCalls = 0
})

type BucketCalls = { put: number; get: number }
function recordingBucket(overrides: Partial<LeadFileBucket> = {}): { bucket: LeadFileBucket; calls: BucketCalls } {
  const calls = { put: 0, get: 0 }
  const inner = env.LEAD_FILES
  const bucket = {
    put: (...args: Parameters<R2Bucket['put']>) => {
      calls.put++
      return overrides.put ? overrides.put(...args) : inner.put(...args)
    },
    get: (...args: Parameters<R2Bucket['get']>) => {
      calls.get++
      return overrides.get ? overrides.get(...args) : inner.get(...args)
    },
    list: (...args: Parameters<R2Bucket['list']>) => inner.list(...args),
    delete: (...args: Parameters<R2Bucket['delete']>) => {
      deleteCalls++
      return inner.delete(...args)
    },
  } as LeadFileBucket
  return { bucket, calls }
}

/** A hand-built upload Request: any Content-Length (or none) and any body stream. */
function rawRequest(cookie: string, leadId: string, kind: string, body: ReadableStream<Uint8Array> | null, contentLength?: string, extra: Record<string, string> = {}) {
  return new Request(uploadUrl(leadId, kind), {
    method: 'POST',
    headers: {
      cookie,
      'sec-fetch-site': 'same-origin',
      origin: BASE,
      ...(contentLength !== undefined ? { 'content-length': contentLength } : {}),
      ...extra,
    },
    body,
  })
}

/** A body stream that yields `chunks`, then ends (or errors, like a client that went away). */
function streamOf(chunks: Uint8Array[], { error = false } = {}) {
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(chunks[i++])
      else if (error) c.error(new Error('client went away'))
      else c.close()
    },
  })
  return { stream }
}
const chunked = (bytes: Uint8Array, size = 1000) => Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size))

function directUpload(request: Request, deps: LeadFilesDeps = {}) {
  return handleUpload(request, env, { bucket: recordingBucket().bucket, ...deps })
}

async function staffAndLead(role: 'admin' | 'staff' = 'staff') {
  const { cookie, email } = await signedInStaff(role, { name: 'Sam Turner' })
  return { cookie, email, leadId: await insertLead() }
}

describe('sign-in and origin', () => {
  it('401 with no session, for upload and download, for a real id and an unknown one', async () => {
    const { cookie, leadId } = await staffAndLead()
    const created = await (await upload(cookie, leadId, 'signed_quote', pdf(100))).json<{ id: string }>()

    expect((await upload(undefined, leadId, 'signed_quote', pdf(100))).status).toBe(401)
    expect((await upload(undefined, crypto.randomUUID(), 'signed_quote', pdf(100))).status).toBe(401)
    expect((await download(undefined, created.id)).status).toBe(401)
    expect((await download(undefined, crypto.randomUUID())).status).toBe(401)
  })

  it('403 for a cross-site Origin or Sec-Fetch-Site', async () => {
    const { cookie, leadId } = await staffAndLead()

    expect((await upload(cookie, leadId, 'signed_quote', pdf(100), { origin: 'https://evil.example' })).status).toBe(403)
    expect((await upload(cookie, leadId, 'signed_quote', pdf(100), { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await upload(cookie, leadId, 'signed_quote', pdf(100), { 'sec-fetch-site': 'same-site' })).status).toBe(403)
    expect(await rowsOf(leadId)).toEqual([])
  })
})

describe('request checks', () => {
  it('400 unknown kind, 404 unknown Lead', async () => {
    const { cookie, leadId } = await staffAndLead()

    expect((await upload(cookie, leadId, 'invoice', pdf(100))).status).toBe(400)
    expect((await upload(cookie, crypto.randomUUID(), 'signed_quote', pdf(100))).status).toBe(404)
  })

  it('411 for a missing or malformed Content-Length, 400 for zero, 413 for 26,214,401 declared', async () => {
    const { cookie, leadId } = await staffAndLead()
    const { bucket, calls } = recordingBucket()

    const missing = await handleUpload(rawRequest(cookie, leadId, 'signed_quote', streamOf([pdf(100)]).stream), env, { bucket })
    const malformed = await handleUpload(rawRequest(cookie, leadId, 'signed_quote', streamOf([pdf(100)]).stream, '1e3'), env, { bucket })
    const negative = await handleUpload(rawRequest(cookie, leadId, 'signed_quote', streamOf([pdf(100)]).stream, '-5'), env, { bucket })
    const tooBig = await handleUpload(rawRequest(cookie, leadId, 'signed_quote', streamOf([pdf(100)]).stream, String(MAX + 1)), env, { bucket })
    const zero = await upload(cookie, leadId, 'signed_quote', new Uint8Array())

    expect([missing.status, malformed.status, negative.status]).toEqual([411, 411, 411])
    expect(tooBig.status).toBe(413)
    expect(await tooBig.text()).toBe(UPLOAD_MESSAGES.tooBig)
    expect(zero.status).toBe(400)
    expect(calls.put).toBe(0)
    expect(await rowsOf(leadId)).toEqual([])
  })
})

describe('streaming upload', () => {
  it('201 stores the sniffed type, the size and the object at leads/<leadId>/<fileId>', async () => {
    const { cookie, email, leadId } = await staffAndLead()

    const res = await upload(cookie, leadId, 'signed_quote', pdf(5000), { 'content-type': 'image/png' })

    expect(res.status).toBe(201)
    const body = await res.json<Record<string, unknown>>()
    expect(body).toMatchObject({ leadId, kind: 'signed_quote', fileName: 'Smith quote.pdf', contentType: 'application/pdf', sizeBytes: 5000 })
    const row = await rowById(body.id as string)
    const staffId = await env.DB.prepare('SELECT id FROM user WHERE email = ?').bind(email).first('id')
    expect(row).toMatchObject({ content_type: 'application/pdf', size_bytes: 5000, r2_key: `leads/${leadId}/${body.id}`, uploaded_by: staffId, removed_at: null })
    const object = await env.LEAD_FILES.head(`leads/${leadId}/${body.id}`)
    expect(object?.size).toBe(5000)
    expect(object?.httpMetadata?.contentType).toBe('application/pdf')
  })

  it('a file of exactly 25 MiB streams in; the row and the R2 object agree on its size', async () => {
    const { cookie, leadId } = await staffAndLead()

    const res = await upload(cookie, leadId, 'materials_list', pdf(MAX))

    expect(res.status).toBe(201)
    const { id } = await res.json<{ id: string }>()
    expect((await rowById(id))?.size_bytes).toBe(MAX)
    expect((await env.LEAD_FILES.head(`leads/${leadId}/${id}`))?.size).toBe(MAX)
  })

  it('415 for an SVG named .pdf; nothing stored', async () => {
    const { cookie, leadId } = await staffAndLead()
    const svg = enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

    const res = await upload(cookie, leadId, 'customer_quote', svg, { 'x-file-name': 'quote.pdf', 'content-type': 'application/pdf' })

    expect(res.status).toBe(415)
    expect(await res.text()).toBe(UPLOAD_MESSAGES.badType)
    expect(await rowsOf(leadId)).toEqual([])
    expect(await objectsUnder(leadId)).toEqual([])
  })

  it('overflow: declared 1,000, body 1,001 (the extra byte after the prefix, mid-stream) -> 413, no row, the request completes', async () => {
    const { cookie, leadId } = await staffAndLead()
    const bytes = pdf(1001)
    const { bucket, calls } = recordingBucket()
    const { stream } = streamOf([bytes.subarray(0, 1000), bytes.subarray(1000)])

    const res = await handleUpload(rawRequest(cookie, leadId, 'signed_quote', stream, '1000'), env, { bucket })

    expect(res.status).toBe(413)
    expect(await res.text()).toBe(UPLOAD_MESSAGES.tooBig)
    expect(calls.put).toBe(1)
    expect(await rowsOf(leadId)).toEqual([])
  })

  it('overflow inside the prefix: declared 1,000, body 1,001 in 300-byte chunks -> 413 before any put', async () => {
    const { cookie, leadId } = await staffAndLead()
    const { bucket, calls } = recordingBucket()

    const res = await handleUpload(rawRequest(cookie, leadId, 'signed_quote', streamOf(chunked(pdf(1001), 300)).stream, '1000'), env, { bucket })

    expect(res.status).toBe(413)
    expect(calls.put).toBe(0)
    expect(await rowsOf(leadId)).toEqual([])
  })

  it.each([
    ['after the prefix', 6000],
    ['inside the 4 KiB prefix', 2000],
  ])('truncated %s: declared 10,000 -> 400 cut off, no row', async (_label, sent) => {
    const { cookie, leadId } = await staffAndLead()

    const res = await directUpload(rawRequest(cookie, leadId, 'signed_quote', streamOf(chunked(pdf(sent))).stream, '10000'))

    expect(res.status).toBe(400)
    expect(await res.text()).toBe(UPLOAD_MESSAGES.cutOff)
    expect(await rowsOf(leadId)).toEqual([])
  })

  it('cancelled: the body stream errors mid-upload -> no row, the request completes', async () => {
    const { cookie, leadId } = await staffAndLead()
    const { stream } = streamOf(chunked(pdf(6000)), { error: true })

    const res = await directUpload(rawRequest(cookie, leadId, 'signed_quote', stream, '20000'))

    expect(res.status).toBe(400)
    expect(await rowsOf(leadId)).toEqual([])
  })

  it('cancelled inside the prefix -> 400, no put', async () => {
    const { cookie, leadId } = await staffAndLead()
    const { bucket, calls } = recordingBucket()

    const res = await handleUpload(rawRequest(cookie, leadId, 'signed_quote', streamOf([pdf(1000)], { error: true }).stream, '20000'), env, { bucket })

    expect(res.status).toBe(400)
    expect(calls.put).toBe(0)
  })
})

describe('one current file per slot', () => {
  it('a second Signed quote without x-replace -> 409; the first stays current', async () => {
    const { cookie, leadId } = await staffAndLead()
    const first = await (await upload(cookie, leadId, 'signed_quote', pdf(100))).json<{ id: string }>()

    const second = await upload(cookie, leadId, 'signed_quote', pdf(200))

    expect(second.status).toBe(409)
    expect(await second.text()).toBe(UPLOAD_MESSAGES.changed)
    expect((await rowsOf(leadId)).map((r) => [r.id, r.removed_at])).toEqual([[first.id, null]])
  })

  it('replace soft-removes the old row; the old file still downloads by id', async () => {
    const { cookie, leadId } = await staffAndLead()
    const old = await (await upload(cookie, leadId, 'customer_quote', pdf(100))).json<{ id: string }>()

    const res = await upload(cookie, leadId, 'customer_quote', png(300), { 'x-replace': old.id, 'x-file-name': 'Quote v2.png' })

    expect(res.status).toBe(201)
    const next = await res.json<{ id: string; fileName: string }>()
    expect(next.fileName).toBe('Quote v2.png')
    expect(await rowById(old.id)).toMatchObject({ removed_reason: 'replaced', replaced_by_id: next.id, removed_at: expect.any(Number) })
    expect(await rowById(next.id)).toMatchObject({ removed_at: null, content_type: 'image/png', size_bytes: 300 })
    const oldFile = await download(cookie, old.id)
    expect(oldFile.status).toBe(200)
    expect((await oldFile.arrayBuffer()).byteLength).toBe(100)
  })

  describe('a stale x-replace -> 409', () => {
    async function slotWithHistory() {
      const { cookie, leadId } = await staffAndLead()
      const replaced = await (await upload(cookie, leadId, 'signed_quote', pdf(100))).json<{ id: string }>()
      const current = await (await upload(cookie, leadId, 'signed_quote', pdf(110), { 'x-replace': replaced.id })).json<{ id: string }>()
      const removedFile = await (await upload(cookie, leadId, 'hover_report', pdf(120))).json<{ id: string }>()
      await serverFnResult(await callServerFn(removeLeadFile, cookie, { fileId: removedFile.id }))
      const otherSlot = await (await upload(cookie, leadId, 'materials_list', pdf(130))).json<{ id: string }>()
      const otherLead = await insertLead()
      const foreign = await (await upload(cookie, otherLead, 'signed_quote', pdf(140))).json<{ id: string }>()
      return { cookie, leadId, replaced, current, removedFile, otherSlot, foreign }
    }

    it('fast fail: a removed file, a replaced file, another Lead\'s and another slot\'s; no bytes reach R2', async () => {
      const s = await slotWithHistory()
      const before = await rowsOf(s.leadId)
      const { bucket, calls } = recordingBucket()
      const attempt = async (kind: string, replace: string) =>
        handleUpload(rawRequest(s.cookie, s.leadId, kind, streamOf([pdf(500)]).stream, '500', { 'x-replace': replace }), env, { bucket })

      const results = [
        await attempt('hover_report', s.removedFile.id),
        await attempt('signed_quote', s.replaced.id),
        await attempt('signed_quote', s.foreign.id),
        await attempt('signed_quote', s.otherSlot.id),
      ]

      for (const res of results) {
        expect(res.status).toBe(409)
        expect(await res.text()).toBe(UPLOAD_MESSAGES.stale)
      }
      expect(calls.put).toBe(0)
      expect(await rowsOf(s.leadId)).toEqual(before)
    })

    it('batch path: the target is replaced by someone else after our put -> 409; their file stays current, ours is an orphan', async () => {
      const { cookie, leadId } = await staffAndLead()
      const target = await (await upload(cookie, leadId, 'signed_quote', pdf(100))).json<{ id: string }>()
      let ours = ''
      let theirs = ''

      const res = await directUpload(rawRequest(cookie, leadId, 'signed_quote', streamOf([pdf(700)]).stream, '700', { 'x-replace': target.id }), {
        afterPut: async ({ fileId }) => {
          ours = fileId
          // Another Staff member's replace of the same file commits first.
          const other = await upload(cookie, leadId, 'signed_quote', pdf(800), { 'x-replace': target.id })
          theirs = (await other.json<{ id: string }>()).id
        },
      })

      expect(res.status).toBe(409)
      expect(await res.text()).toBe(UPLOAD_MESSAGES.stale)
      expect(await rowById(ours)).toBeNull()
      expect(await rowById(target.id)).toMatchObject({ replaced_by_id: theirs })
      expect(await rowById(theirs)).toMatchObject({ removed_at: null })
      expect((await download(cookie, theirs)).status).toBe(200)
      expect((await env.LEAD_FILES.head(`leads/${leadId}/${ours}`))?.size).toBe(700)
    })

    it('batch path: the target is removed after our put -> 409; it stays as the remove left it, ours is an orphan', async () => {
      const { cookie, leadId } = await staffAndLead()
      const target = await (await upload(cookie, leadId, 'hover_report', pdf(100))).json<{ id: string }>()
      let ours = ''

      const res = await directUpload(rawRequest(cookie, leadId, 'hover_report', streamOf([pdf(300)]).stream, '300', { 'x-replace': target.id }), {
        afterPut: async ({ fileId }) => {
          ours = fileId
          await serverFnResult(await callServerFn(removeLeadFile, cookie, { fileId: target.id }))
        },
      })

      expect(res.status).toBe(409)
      expect(await rowById(target.id)).toMatchObject({ removed_reason: 'removed', replaced_by_id: null })
      expect(await rowById(ours)).toBeNull()
      expect((await download(cookie, target.id)).status).toBe(200)
      expect(await objectsUnder(leadId)).toContain(`leads/${leadId}/${ours}`)
    })
  })

  it('batch commits, then the D1 call throws -> 500 "may not have saved"; the row and object exist and the file downloads', async () => {
    const { cookie, leadId } = await staffAndLead()
    const d1: LeadFilesDeps['d1'] = {
      prepare: (query: string) => env.DB.prepare(query),
      batch: async (statements) => {
        await env.DB.batch(statements)
        throw new Error('D1_ERROR: Network connection lost.')
      },
    }

    const res = await directUpload(rawRequest(cookie, leadId, 'contractor_agreement', streamOf([pdf(900)]).stream, '900'), { d1 })

    expect(res.status).toBe(500)
    expect(await res.text()).toBe(UPLOAD_MESSAGES.uncertain)
    const [row] = await rowsOf(leadId)
    expect(row).toMatchObject({ kind: 'contractor_agreement', size_bytes: 900, removed_at: null })
    expect((await env.LEAD_FILES.head(row.r2_key))?.size).toBe(900)
    const file = await download(cookie, row.id)
    expect(file.status).toBe(200)
    expect((await file.arrayBuffer()).byteLength).toBe(900)
  })

  describe('races', () => {
    const statuses = (responses: Response[]) => responses.map((r) => r.status).sort()

    it('two uploads in parallel into one empty slot: one 201, one 409, one current row', async () => {
      const { cookie, leadId } = await staffAndLead()

      const results = await Promise.all([upload(cookie, leadId, 'signed_quote', pdf(5000)), upload(cookie, leadId, 'signed_quote', pdf(6000))])

      expect(statuses(results)).toEqual([201, 409])
      expect((await rowsOf(leadId)).filter((r) => r.removed_at === null)).toHaveLength(1)
    })

    it('two replaces of the same file in parallel: one 201, one 409', async () => {
      const { cookie, leadId } = await staffAndLead()
      const old = await (await upload(cookie, leadId, 'signed_quote', pdf(100))).json<{ id: string }>()

      const results = await Promise.all([
        upload(cookie, leadId, 'signed_quote', pdf(5000), { 'x-replace': old.id }),
        upload(cookie, leadId, 'signed_quote', pdf(6000), { 'x-replace': old.id }),
      ])

      expect(statuses(results)).toEqual([201, 409])
      expect((await rowsOf(leadId)).filter((r) => r.removed_at === null)).toHaveLength(1)
    })

    it('a replace and a fresh upload into the same slot: one 201', async () => {
      const { cookie, leadId } = await staffAndLead()
      const old = await (await upload(cookie, leadId, 'signed_quote', pdf(100))).json<{ id: string }>()

      const results = await Promise.all([
        upload(cookie, leadId, 'signed_quote', pdf(5000), { 'x-replace': old.id }),
        upload(cookie, leadId, 'signed_quote', pdf(6000)),
      ])

      expect(statuses(results)).toEqual([201, 409])
      expect((await rowsOf(leadId)).filter((r) => r.removed_at === null)).toHaveLength(1)
    })
  })

  it('an upload racing Lead delete -> 404, no row; the object sits under a recorded prefix', async () => {
    const { cookie, leadId } = await staffAndLead()
    let key = ''

    const res = await directUpload(rawRequest(cookie, leadId, 'signed_quote', streamOf([pdf(400)]).stream, '400'), {
      afterPut: async (file) => {
        key = file.key
        expect(await deleteLeadRecordingFiles(env.DB, leadId)).toBe(true)
      },
    })

    expect(res.status).toBe(404)
    expect(await rowsOf(leadId)).toEqual([])
    expect(key.startsWith(`leads/${leadId}/`)).toBe(true)
    expect((await env.LEAD_FILES.head(key))?.size).toBe(400)
    expect(await env.DB.prepare('SELECT sweeps_done FROM r2_prefix_deletes WHERE prefix = ?').bind(`leads/${leadId}/`).first('sweeps_done')).toBe(0)
  })
})

describe('R2 and D1 failures', () => {
  it('put throws -> 503, no row, the request completes', async () => {
    const { cookie, leadId } = await staffAndLead()
    const { bucket } = recordingBucket({
      put: async () => {
        throw new Error('R2 is down')
      },
    })

    const res = await handleUpload(rawRequest(cookie, leadId, 'signed_quote', streamOf(chunked(pdf(8000))).stream, '8000'), env, { bucket })

    expect(res.status).toBe(503)
    expect(await res.text()).toBe(UPLOAD_MESSAGES.storeFailed)
    expect(await rowsOf(leadId)).toEqual([])
  })

  it('the D1 batch fails with a non-constraint error -> 500, no row', async () => {
    const { cookie, leadId } = await staffAndLead()
    const d1: LeadFilesDeps['d1'] = {
      prepare: (query: string) => env.DB.prepare(query),
      batch: async () => {
        throw new Error('D1_ERROR: internal error')
      },
    }

    const res = await directUpload(rawRequest(cookie, leadId, 'signed_quote', streamOf([pdf(300)]).stream, '300'), { d1 })

    expect(res.status).toBe(500)
    expect(await rowsOf(leadId)).toEqual([])
  })

  it('get throws -> 503; an object missing from R2 -> 404', async () => {
    const { cookie, leadId } = await staffAndLead()
    const { id } = await (await upload(cookie, leadId, 'signed_quote', pdf(100))).json<{ id: string }>()
    const { bucket } = recordingBucket({
      get: async () => {
        throw new Error('R2 is down')
      },
    })
    const request = new Request(`${BASE}/api/lead-files/${id}`, { headers: { cookie } })

    expect((await handleDownload(request, env, id, { bucket })).status).toBe(503)

    await env.LEAD_FILES.delete(`leads/${leadId}/${id}`)
    expect((await download(cookie, id)).status).toBe(404)
    expect((await download(cookie, crypto.randomUUID())).status).toBe(404)
  })
})

describe('download headers', () => {
  it('a PDF opens inline, with no CSP sandbox', async () => {
    const { cookie, leadId } = await staffAndLead()
    const { id } = await (await upload(cookie, leadId, 'customer_quote', pdf(1234), { 'x-file-name': encodeURIComponent('Devis "Hélène".pdf') })).json<{ id: string }>()

    const res = await download(cookie, id)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-length')).toBe('1234')
    // The stored name drops the quote marks (safeFileName); non-ASCII survives in filename*.
    expect(res.headers.get('content-disposition')).toBe(`inline; filename="Devis H_l_ne.pdf"; filename*=UTF-8''Devis%20H%C3%A9l%C3%A8ne.pdf`)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('content-security-policy')).toBeNull()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf(1234))
  })

  it('?download=1 is an attachment', async () => {
    const { cookie, leadId } = await staffAndLead()
    const { id } = await (await upload(cookie, leadId, 'customer_quote', pdf(100))).json<{ id: string }>()

    expect((await download(cookie, id, '?download=1')).headers.get('content-disposition')).toMatch(/^attachment; filename="Smith quote.pdf"; filename\*=UTF-8''/)
  })

  it('an image gets the CSP sandbox; HEIC is always an attachment', async () => {
    const { cookie, leadId } = await staffAndLead()
    const image = await (await upload(cookie, leadId, 'materials_list', png(), { 'x-file-name': 'list.png' })).json<{ id: string }>()
    const photo = await (await upload(cookie, leadId, 'hover_report', heic(), { 'x-file-name': 'IMG_0042.HEIC' })).json<{ id: string; contentType: string }>()
    expect(photo.contentType).toBe('image/heic')

    const pngRes = await download(cookie, image.id)
    const heicRes = await download(cookie, photo.id)

    expect(pngRes.headers.get('content-disposition')).toMatch(/^inline; filename="list.png"/)
    expect(pngRes.headers.get('content-security-policy')).toBe("default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
    expect(heicRes.headers.get('content-type')).toBe('image/heic')
    expect(heicRes.headers.get('content-disposition')).toMatch(/^attachment; filename="IMG_0042.heic"/)
    expect(heicRes.headers.get('content-security-policy')).not.toBeNull()
  })
})

describe('list and remove', () => {
  it('listLeadFiles gives every slot, current files only, with the uploader name', async () => {
    const { cookie, leadId } = await staffAndLead()
    const old = await (await upload(cookie, leadId, 'signed_quote', pdf(100))).json<{ id: string }>()
    const current = await (await upload(cookie, leadId, 'signed_quote', pdf(200), { 'x-replace': old.id })).json<{ id: string }>()

    const files = await serverFnResult<Record<string, { id: string; sizeBytes: number; uploadedByName: string | null } | null>>(
      await callServerFn(listLeadFiles, cookie, { leadId }),
    )

    expect(Object.keys(files)).toEqual(['hover_report', 'materials_list', 'customer_quote', 'signed_quote', 'contractor_agreement'])
    expect(files.signed_quote).toMatchObject({ id: current.id, sizeBytes: 200, uploadedByName: 'Sam Turner' })
    expect(files.hover_report).toBeNull()
  })

  it('any Staff member removes a file (soft); a second remove -> 404', async () => {
    const { cookie, leadId } = await staffAndLead('staff')
    const { id } = await (await upload(cookie, leadId, 'materials_list', pdf(100))).json<{ id: string }>()

    expect((await callServerFn(removeLeadFile, cookie, { fileId: id })).status).toBe(200)
    expect(await rowById(id)).toMatchObject({ removed_reason: 'removed', removed_at: expect.any(Number), replaced_by_id: null })
    expect(await objectsUnder(leadId)).toEqual([`leads/${leadId}/${id}`])
    expect((await callServerFn(removeLeadFile, cookie, { fileId: id })).status).toBe(404)
  })
})

it('uploads, replaces and removes never touch the stage, Follow-ups or lead_activity', async () => {
  const { cookie, leadId } = await staffAndLead()
  const snapshot = async () => ({
    lead: await env.DB.prepare('SELECT stage, updated_at FROM leads WHERE id = ?').bind(leadId).first(),
    activity: await env.DB.prepare('SELECT count(*) AS n FROM lead_activity WHERE lead_id = ?').bind(leadId).first('n'),
    stageChanges: await env.DB.prepare('SELECT count(*) AS n FROM lead_stage_changes WHERE lead_id = ?').bind(leadId).first('n'),
  })
  const before = await snapshot()

  const first = await (await upload(cookie, leadId, 'customer_quote', pdf(100))).json<{ id: string }>()
  expect(await snapshot()).toEqual(before)
  const second = await (await upload(cookie, leadId, 'customer_quote', pdf(200), { 'x-replace': first.id })).json<{ id: string }>()
  expect(await snapshot()).toEqual(before)
  await serverFnResult(await callServerFn(removeLeadFile, cookie, { fileId: second.id }))
  expect(await snapshot()).toEqual(before)
  expect(before.lead).toMatchObject({ stage: 'new' })
})
