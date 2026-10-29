import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { moveLeadStage } from '#/lib/leads.functions'
import { exifTakenAt, hasJpegMetadata, stripJpegMetadata } from '#/lib/jpeg'
import { createPhotoDevice, createPhotoLink, getPhotoHome, getPhotoRequest, listPhotos, revokePhotoLink, updatePhoto } from '#/lib/photos.functions'
import { shortWho } from '#/lib/photos.server'
import { randomPhone } from './intake-helpers'
import { insertLead } from './lead-helpers'
import { BASE, callServerFn, serverFnResult, signedInStaff } from './staff'

// GLOSSARY Photo, Photo link, Photo home screen.

// ---------------------------------------------------------------------------
// A small JPEG with an Exif block holding a capture time and a GPS pointer (the bytes after SOS are not a real image;
// the server only reads the header).

const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

function exifApp1(date: string): number[] {
  // TIFF, big-endian. IFD0: ExifIFD pointer (0x8769) and GPS pointer (0x8825). Exif IFD: DateTimeOriginal (0x9003).
  const tiff: number[] = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]
  const ifd0At = 8
  const ifd0Len = 2 + 2 * 12 + 4
  const exifAt = ifd0At + ifd0Len
  const exifLen = 2 + 12 + 4
  const dateAt = exifAt + exifLen
  const entry = (tag: number, type: number, count: number, value: number) => [...u16be(tag), ...u16be(type), 0, 0, ...u16be(count), (value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
  tiff.push(...u16be(2), ...entry(0x8769, 4, 1, exifAt), ...entry(0x8825, 4, 1, dateAt + 20), 0, 0, 0, 0)
  tiff.push(...u16be(1), ...entry(0x9003, 2, 20, dateAt), 0, 0, 0, 0)
  tiff.push(...ascii(date), 0)
  tiff.push(...ascii('GPS 40.3356 -75.9269'))
  const body = [...ascii('Exif'), 0, 0, ...tiff]
  return [0xff, 0xe1, ...u16be(body.length + 2), ...body]
}

function jpeg(opts: { exif?: boolean; date?: string } = {}): Uint8Array {
  const app0 = [0xff, 0xe0, ...u16be(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  const sof = [0xff, 0xc0, ...u16be(17), 8, ...u16be(1200), ...u16be(1600), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  const sos = [0xff, 0xda, ...u16be(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]
  return new Uint8Array([0xff, 0xd8, ...app0, ...(opts.exif === false ? [] : exifApp1(opts.date ?? '2026:05:01 14:30:00')), ...sof, ...sos, 1, 2, 3, 4, 5, 0xff, 0xd9])
}

describe('JPEG metadata', () => {
  it('reads the capture time and then strips Exif (and its GPS) but keeps the image and its size', () => {
    const original = jpeg()
    expect(exifTakenAt(original)).toEqual({ year: 2026, month: 5, day: 1, hour: 14, minute: 30, second: 0 })
    expect(hasJpegMetadata(original)).toBe(true)
    const clean = stripJpegMetadata(original)!
    expect(hasJpegMetadata(clean.bytes)).toBe(false)
    expect(new TextDecoder().decode(clean.bytes)).not.toContain('GPS')
    expect(clean).toMatchObject({ width: 1600, height: 1200 })
    expect([...clean.bytes.slice(-7)]).toEqual([1, 2, 3, 4, 5, 0xff, 0xd9])
  })

  it('refuses bytes that are not a JPEG it can parse', () => {
    expect(stripJpegMetadata(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(stripJpegMetadata(jpeg().slice(0, 30))).toBeNull()
  })
})

describe('shortWho', () => {
  it('shows first name, last initial and the street without its number', () => {
    expect(shortWho({ first_name: 'Tom', last_name: 'Williamson', street: '236 Sunrise Rd' })).toBe('Tom W., Sunrise Rd')
    expect(shortWho({ first_name: 'Dennis', last_name: null, street: null })).toBe('Dennis')
  })
})

// ---------------------------------------------------------------------------

const tokenOf = (url: string) => new URL(url).pathname.split('/').pop()!

async function newLink(cookie: string, data: { leadId?: string; jobId?: string; stage: string }) {
  return serverFnResult<{ id: string; url: string; message: string; title: string }>(await callServerFn(createPhotoLink, cookie, data))
}

function upload(query: string, bytes = jpeg(), takenAt?: number) {
  const form = new FormData()
  form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), 'photo.jpg')
  form.append('thumb', new Blob([jpeg()], { type: 'image/jpeg' }), 'thumb.jpg')
  if (takenAt) form.append('takenAt', String(takenAt))
  return SELF.fetch(`${BASE}/api/public/photos?${query}`, { method: 'POST', body: form })
}

const photoRow = (id: string) => env.DB.prepare('SELECT * FROM photos WHERE id = ?').bind(id).first<Record<string, unknown>>()

describe('photo links', () => {
  it('Staff make a link; Pat uploads through it with no sign-in; the stored photo has no metadata', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ firstName: 'Tom', lastName: 'Williamson', phoneE164: `+1${randomPhone()}` })
    const link = await newLink(cookie, { leadId, stage: 'before' })
    expect(link.title).toBe('Before photos for Tom W., Main St')
    expect(link.message).toContain(link.url)

    const res = await upload(`t=${tokenOf(link.url)}`, jpeg(), Date.UTC(2026, 4, 1, 18, 30))
    expect(res.status).toBe(201)
    const { id } = await res.json<{ id: string }>()
    expect(await photoRow(id)).toMatchObject({ lead_id: leadId, job_id: null, stage: 'before', width: 1600, height: 1200, taken_at: Date.UTC(2026, 4, 1, 18, 30), photo_link_id: link.id })
    const stored = await env.LEAD_FILES.get(`photos/${id}.jpg`)
    const bytes = new Uint8Array(await stored!.arrayBuffer())
    expect(hasJpegMetadata(bytes)).toBe(false)
    expect(await env.LEAD_FILES.get(`photos/${id}_t.jpg`)).not.toBeNull()
  })

  it('the upload page shows the title and what was sent; a wrong token shows nothing', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ phoneE164: `+1${randomPhone()}` })
    const link = await newLink(cookie, { leadId, stage: 'before' })
    const { id } = await (await upload(`t=${tokenOf(link.url)}`)).json<{ id: string }>()

    const view = await serverFnResult<{ title: string; photoIds: string[] }>(await callServerFn(getPhotoRequest, undefined, { t: tokenOf(link.url) }))
    expect(view).toMatchObject({ title: 'Before photos for Hannah H., Main St', photoIds: [id] })
    expect(await serverFnResult(await callServerFn(getPhotoRequest, undefined, { t: 'x'.repeat(43) }))).toBeNull()

    const page = await SELF.fetch(`${BASE}/p/${tokenOf(link.url)}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Take a photo')
  })

  it('refuses a turned-off link, a non-JPEG and an unknown token', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ phoneE164: `+1${randomPhone()}` })
    const link = await newLink(cookie, { leadId, stage: 'before' })
    const t = tokenOf(link.url)

    expect((await upload(`t=${t}`, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))).status).toBe(415)
    expect((await upload(`t=${'y'.repeat(43)}`)).status).toBe(410)
    await serverFnResult(await callServerFn(revokePhotoLink, cookie, { linkId: link.id }))
    expect((await upload(`t=${t}`)).status).toBe(410)
  })

  it('an expired link is refused', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ phoneE164: `+1${randomPhone()}` })
    const link = await newLink(cookie, { leadId, stage: 'before' })
    await env.DB.prepare('UPDATE photo_links SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, link.id).run()
    expect((await upload(`t=${tokenOf(link.url)}`)).status).toBe(410)
  })

  it("Pat's page only shows photos sent through its own link", async () => {
    const { cookie } = await signedInStaff('staff')
    const a = await newLink(cookie, { leadId: await insertLead({ phoneE164: `+1${randomPhone()}` }), stage: 'before' })
    const b = await newLink(cookie, { leadId: await insertLead({ phoneE164: `+1${randomPhone()}` }), stage: 'before' })
    const { id } = await (await upload(`t=${tokenOf(a.url)}`)).json<{ id: string }>()
    expect((await SELF.fetch(`${BASE}/api/public/photos/${id}?t=${tokenOf(a.url)}`)).status).toBe(200)
    expect((await SELF.fetch(`${BASE}/api/public/photos/${id}?t=${tokenOf(b.url)}`)).status).toBe(404)
    expect((await SELF.fetch(`${BASE}/api/photos/${id}`)).status).toBe(401)
    expect((await SELF.fetch(`${BASE}/api/photos/${id}?size=thumb`, { headers: { cookie } })).status).toBe(200)
  })

  it("winning the Lead moves its before photos to the new Job, and later uploads on the Lead's link go there too", async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ phoneE164: `+1${randomPhone()}` })
    const link = await newLink(cookie, { leadId, stage: 'before' })
    const first = (await (await upload(`t=${tokenOf(link.url)}`)).json<{ id: string }>()).id

    await serverFnResult(await callServerFn(moveLeadStage, cookie, { leadId, stage: 'won' }))
    const jobId = await env.DB.prepare('SELECT id FROM jobs WHERE lead_id = ?').bind(leadId).first<string>('id')
    expect((await photoRow(first))?.job_id).toBe(jobId)

    const second = (await (await upload(`t=${tokenOf(link.url)}`)).json<{ id: string }>()).id
    expect((await photoRow(second))?.job_id).toBe(jobId)

    const onJob = await serverFnResult<{ id: string }[]>(await callServerFn(listPhotos, cookie, { jobId }))
    expect(onJob.map((p) => p.id).sort()).toEqual([first, second].sort())
    const customerId = await env.DB.prepare('SELECT customer_id FROM jobs WHERE id = ?').bind(jobId).first<string>('customer_id')
    expect(await serverFnResult<unknown[]>(await callServerFn(listPhotos, cookie, { customerId }))).toHaveLength(2)
  })

  it('Staff can star and hide a photo (photos are never deleted)', async () => {
    const { cookie } = await signedInStaff('staff')
    const link = await newLink(cookie, { leadId: await insertLead({ phoneE164: `+1${randomPhone()}` }), stage: 'during' })
    const { id } = await (await upload(`t=${tokenOf(link.url)}`)).json<{ id: string }>()
    await serverFnResult(await callServerFn(updatePhoto, cookie, { photoId: id, favorite: true, hidden: true }))
    expect(await photoRow(id)).toMatchObject({ favorite: 1, hidden: 1, stage: 'during' })
  })

  it('refuses a stage that is not before, during or after', async () => {
    const { cookie } = await signedInStaff('staff')
    const res = await callServerFn(createPhotoLink, cookie, { leadId: await insertLead({ phoneE164: `+1${randomPhone()}` }), stage: 'mock' })
    expect(res.status).toBe(400)
  })
})

describe('Staff uploads', () => {
  it('Staff add an AI mock to a Lead from the CRM; metadata is stripped and it is marked as a mock', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ phoneE164: `+1${randomPhone()}` })
    const form = new FormData()
    form.append('photo', new Blob([jpeg()], { type: 'image/jpeg' }), 'mock.jpg')
    const res = await SELF.fetch(`${BASE}/api/photos?lead=${leadId}&stage=mock`, { method: 'POST', body: form, headers: { cookie, origin: BASE } })
    expect(res.status).toBe(201)
    const { id } = await res.json<{ id: string }>()
    expect(await photoRow(id)).toMatchObject({ lead_id: leadId, stage: 'mock', photo_link_id: null })
    expect((await photoRow(id))?.uploaded_by).toBeTruthy()
    const bytes = new Uint8Array(await (await env.LEAD_FILES.get(`photos/${id}.jpg`))!.arrayBuffer())
    expect(hasJpegMetadata(bytes)).toBe(false)
  })

  it('refuses a cross-site upload and an unknown stage', async () => {
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ phoneE164: `+1${randomPhone()}` })
    const form = () => {
      const f = new FormData()
      f.append('photo', new Blob([jpeg()], { type: 'image/jpeg' }), 'mock.jpg')
      return f
    }
    expect((await SELF.fetch(`${BASE}/api/photos?lead=${leadId}&stage=mock`, { method: 'POST', body: form(), headers: { cookie, origin: 'https://evil.example' } })).status).toBe(403)
    expect((await SELF.fetch(`${BASE}/api/photos?lead=${leadId}&stage=other`, { method: 'POST', body: form(), headers: { cookie, origin: BASE } })).status).toBe(400)
  })
})

describe('photo home screen', () => {
  it("lists open links and lets Pat upload to one without its own token; a staff-role user cannot make one", async () => {
    const { cookie: staffCookie } = await signedInStaff('staff')
    expect((await callServerFn(createPhotoDevice, staffCookie, { name: "Pat's phone" })).status).toBe(403)

    const { cookie } = await signedInStaff('admin')
    const device = await serverFnResult<{ url: string }>(await callServerFn(createPhotoDevice, cookie, { name: "Pat's phone" }))
    const d = tokenOf(device.url)
    const link = await newLink(cookie, { leadId: await insertLead({ firstName: 'Linda', lastName: 'Theisen', phoneE164: `+1${randomPhone()}` }), stage: 'after' })

    const home = await serverFnResult<{ requests: { linkId: string; title: string }[] }>(await callServerFn(getPhotoHome, undefined, { d }))
    expect(home.requests).toContainEqual(expect.objectContaining({ linkId: link.id, title: 'After photos for Linda T., Main St' }))
    expect((await upload(`d=${d}&l=${link.id}`)).status).toBe(201)
    expect((await upload(`d=${'z'.repeat(43)}&l=${link.id}`)).status).toBe(410)
  })
})
