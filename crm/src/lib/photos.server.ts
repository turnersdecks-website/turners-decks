import { type AuthEnv, createAuth } from '#/lib/auth'
import { isJpeg, stripJpegMetadata } from '#/lib/jpeg'
import { CLOSED_JOB_STATUSES } from '#/lib/job-statuses'
import { PHOTO_LINK_MS, PHOTO_MAX_BYTES, PHOTO_STAGE_LABELS, PHOTO_THUMB_MAX_BYTES, type LinkStage, isLinkStage, isPhotoStage } from '#/lib/photo-vocab'
import { isSameOrigin } from '#/lib/same-origin'

// Photos (GLOSSARY Photo, Photo link, Photo home screen): links for Pat, his upload page's server side, and the image
// routes. Pat's page needs no sign-in: a link is a long random token that can only add photos to its one Lead or Job.
// Only SHA-256 hashes of tokens are stored. Every stored image is a JPEG re-written without metadata (no GPS).

export type PhotosEnv = AuthEnv & Pick<Env, 'LEAD_FILES'>
type D1 = Pick<D1Database, 'prepare' | 'batch'>

const text = (body: string, status: number) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
const closed = CLOSED_JOB_STATUSES.map((s) => `'${s}'`).join(', ')

export const PHOTO_MESSAGES = {
  expired: 'This photo link has expired or was turned off. Ask Kristin for a new one.',
  notJpeg: 'That photo could not be read. Try again, or take it again.',
  tooBig: 'That photo is too large.',
  storeFailed: 'Upload failed. It will try again.',
} as const

// ---------------------------------------------------------------------------
// Tokens

/** A new token: 32 random bytes, base64url (43 characters). */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const plausibleToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(t)

export type PhotoLinkRow = {
  id: string
  lead_id: string | null
  job_id: string | null
  stage: LinkStage
  expires_at: number
  revoked_at: number | null
  done_at: number | null
}

const LINK_COLUMNS = 'id, lead_id, job_id, stage, expires_at, revoked_at, done_at'
const usable = (l: PhotoLinkRow | null, now: number) => (l && l.revoked_at === null && l.expires_at > now ? l : null)

/** The working link for a token, or null (unknown, expired or turned off: all look the same to the caller). */
export async function linkForToken(d1: D1, token: unknown, now = Date.now()): Promise<PhotoLinkRow | null> {
  if (!plausibleToken(token)) return null
  const row = await d1.prepare(`SELECT ${LINK_COLUMNS} FROM photo_links WHERE token_hash = ?`).bind(await hashToken(token)).first<PhotoLinkRow>()
  return usable(row, now)
}

/** The working Photo home screen for a token, or null. */
export async function deviceForToken(d1: D1, token: unknown): Promise<{ id: string; name: string } | null> {
  if (!plausibleToken(token)) return null
  return d1
    .prepare('SELECT id, name FROM photo_devices WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await hashToken(token))
    .first<{ id: string; name: string }>()
}

/**
 * Who is uploading, from either credential: a link token (`t`), or a home screen token (`d`) plus a link id (`l`).
 * A home screen can open any link that still works.
 */
export async function linkForCredentials(d1: D1, c: { t?: unknown; d?: unknown; l?: unknown }, now = Date.now()): Promise<PhotoLinkRow | null> {
  if (c.t !== undefined && c.t !== null && c.t !== '') return linkForToken(d1, c.t, now)
  if (!(await deviceForToken(d1, c.d))) return null
  if (typeof c.l !== 'string' || c.l.length > 100) return null
  const row = await d1.prepare(`SELECT ${LINK_COLUMNS} FROM photo_links WHERE id = ?`).bind(c.l).first<PhotoLinkRow>()
  return usable(row, now)
}

const credentialsFrom = (url: URL) => ({ t: url.searchParams.get('t'), d: url.searchParams.get('d'), l: url.searchParams.get('l') })

// ---------------------------------------------------------------------------
// What the upload page shows

/** "Tom W., Sunrise Rd": first name, last initial, street without the house number. Never the full address. */
export function shortWho(p: { first_name: string | null; last_name: string | null; street: string | null }): string {
  const name = [p.first_name?.trim(), p.last_name?.trim() ? `${p.last_name.trim()[0]}.` : null].filter(Boolean).join(' ')
  const street = p.street?.replace(/^\s*\d+[A-Za-z]?\s+/, '').trim() || null
  return [name || 'Customer', street].filter(Boolean).join(', ')
}

type Who = { first_name: string | null; last_name: string | null; street: string | null }

async function whoFor(d1: D1, link: Pick<PhotoLinkRow, 'lead_id' | 'job_id'>): Promise<Who> {
  if (link.job_id) {
    const job = await d1
      .prepare(
        `SELECT c.first_name, c.last_name, coalesce(c.street, l.street) AS street
         FROM jobs j JOIN customers c ON c.id = j.customer_id LEFT JOIN leads l ON l.id = j.lead_id WHERE j.id = ?`,
      )
      .bind(link.job_id)
      .first<Who>()
    if (job) return job
  }
  return (
    (await d1.prepare('SELECT first_name, last_name, street FROM leads WHERE id = ?').bind(link.lead_id).first<Who>()) ?? {
      first_name: null,
      last_name: null,
      street: null,
    }
  )
}

export const requestTitle = (stage: LinkStage, who: string) => `${PHOTO_STAGE_LABELS[stage]} photos for ${who}`

/** The upload page's data for a working link: its title and the photos already sent through it. */
export async function photoRequestView(d1: D1, link: PhotoLinkRow) {
  const who = shortWho(await whoFor(d1, link))
  const photos = await d1
    .prepare('SELECT id FROM photos WHERE photo_link_id = ? AND hidden = 0 ORDER BY uploaded_at')
    .bind(link.id)
    .all<{ id: string }>()
  return {
    linkId: link.id,
    stage: link.stage,
    title: requestTitle(link.stage, who),
    expiresAt: link.expires_at,
    done: link.done_at !== null,
    photoIds: photos.results.map((p) => p.id),
  }
}

/** A home screen's list: every link that still works, newest first. */
export async function photoHomeView(d1: D1, now = Date.now()) {
  const links = await d1
    .prepare(`SELECT ${LINK_COLUMNS}, created_at FROM photo_links WHERE revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 50`)
    .bind(now)
    .all<PhotoLinkRow & { created_at: number }>()
  const out = []
  for (const l of links.results) {
    const count = await d1.prepare('SELECT count(*) AS n FROM photos WHERE photo_link_id = ?').bind(l.id).first<number>('n')
    out.push({ linkId: l.id, title: requestTitle(l.stage, shortWho(await whoFor(d1, l))), done: l.done_at !== null, photoCount: count ?? 0, createdAt: l.created_at })
  }
  return out
}

// ---------------------------------------------------------------------------
// Upload: POST /api/public/photos?t=<token> (or ?d=<home screen>&l=<link id>), multipart: `photo` (JPEG, required),
// `thumb` (JPEG, optional), `takenAt` (epoch ms, optional). 201 with the photo id.

export type PhotoDeps = { bucket?: Pick<R2Bucket, 'put' | 'get'>; now?: () => number }

export async function handlePhotoUpload(request: Request, env: PhotosEnv, deps: PhotoDeps = {}): Promise<Response> {
  const now = (deps.now ?? Date.now)()
  const link = await linkForCredentials(env.DB, credentialsFrom(new URL(request.url)), now)
  if (!link) return text(PHOTO_MESSAGES.expired, 410)
  const res = await storePhoto(request, env, deps, now, { leadId: link.lead_id, jobId: link.job_id, stage: link.stage, linkId: link.id, uploadedBy: null })
  if (res.status === 201) await env.DB.prepare('UPDATE photo_links SET last_used_at = ? WHERE id = ?').bind(now, link.id).run()
  return res
}

/**
 * `POST /api/photos?lead=<id>` or `?job=<id>`, `&stage=<stage>`: a signed-in Staff member adds photos from the CRM
 * (AI mocks, or real photos they have). Same body and checks as Pat's upload.
 */
export async function handleStaffPhotoUpload(request: Request, env: PhotosEnv, deps: PhotoDeps = {}): Promise<Response> {
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session) return text('Unauthorized', 401)
  if (!isSameOrigin(request)) return text('Cross-site request refused.', 403)
  const q = new URL(request.url).searchParams
  const stage = q.get('stage')
  if (!isPhotoStage(stage)) return text('Stage must be before, during, after or mock.', 400)
  const jobParam = q.get('job')
  const leadParam = q.get('lead')
  let leadId: string | null = null
  let jobId: string | null = null
  if (jobParam) {
    const job = await env.DB.prepare('SELECT id, lead_id FROM jobs WHERE id = ?').bind(jobParam.slice(0, 100)).first<{ id: string; lead_id: string | null }>()
    if (!job) return text('Job not found', 404)
    jobId = job.id
    leadId = job.lead_id
  } else if (leadParam) {
    leadId = await env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(leadParam.slice(0, 100)).first<string>('id')
    if (!leadId) return text('Lead not found', 404)
  } else return text('A Lead or a Job is required.', 400)
  return storePhoto(request, env, deps, (deps.now ?? Date.now)(), { leadId, jobId, stage, linkId: null, uploadedBy: session.user.id })
}

/** The shared upload: multipart `photo` (JPEG), `thumb` (JPEG, optional), `takenAt` (epoch ms, optional). */
async function storePhoto(
  request: Request,
  env: PhotosEnv,
  deps: PhotoDeps,
  now: number,
  to: { leadId: string | null; jobId: string | null; stage: string; linkId: string | null; uploadedBy: string | null },
): Promise<Response> {
  const d1 = env.DB
  const bucket = deps.bucket ?? env.LEAD_FILES
  const declared = Number(request.headers.get('content-length') ?? 'NaN')
  if (Number.isFinite(declared) && declared > PHOTO_MAX_BYTES + PHOTO_THUMB_MAX_BYTES + 64 * 1024) return text(PHOTO_MESSAGES.tooBig, 413)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return text(PHOTO_MESSAGES.notJpeg, 400)
  }
  const photo = form.get('photo')
  const thumb = form.get('thumb')
  if (!(photo instanceof File)) return text(PHOTO_MESSAGES.notJpeg, 400)
  if (photo.size > PHOTO_MAX_BYTES || (thumb instanceof File && thumb.size > PHOTO_THUMB_MAX_BYTES)) return text(PHOTO_MESSAGES.tooBig, 413)

  const full = new Uint8Array(await photo.arrayBuffer())
  if (!isJpeg(full)) return text(PHOTO_MESSAGES.notJpeg, 415)
  const clean = stripJpegMetadata(full)
  if (!clean) return text(PHOTO_MESSAGES.notJpeg, 415)
  let cleanThumb: Uint8Array | null = null
  if (thumb instanceof File && thumb.size > 0) {
    const t = new Uint8Array(await thumb.arrayBuffer())
    cleanThumb = (isJpeg(t) && stripJpegMetadata(t)?.bytes) || null
  }

  const takenRaw = Number(form.get('takenAt'))
  // A capture time in the future or before 2015 is dropped rather than refused.
  const takenAt = Number.isSafeInteger(takenRaw) && takenRaw > Date.UTC(2015, 0, 1) && takenRaw < now + 86_400_000 ? takenRaw : null

  // Photos for a Lead go on the Lead's open Job once it has one (it was won after the link went out).
  const jobId =
    to.jobId ??
    (to.leadId
      ? await d1
          .prepare(`SELECT id FROM jobs WHERE lead_id = ? AND status NOT IN (${closed}) ORDER BY created_at DESC LIMIT 1`)
          .bind(to.leadId)
          .first<string>('id')
      : null)

  const id = crypto.randomUUID()
  const key = `photos/${id}.jpg`
  const thumbKey = cleanThumb ? `photos/${id}_t.jpg` : null
  try {
    await bucket.put(key, clean.bytes, { httpMetadata: { contentType: 'image/jpeg' } })
    if (thumbKey && cleanThumb) await bucket.put(thumbKey, cleanThumb, { httpMetadata: { contentType: 'image/jpeg' } })
  } catch {
    return text(PHOTO_MESSAGES.storeFailed, 503)
  }
  await d1
    .prepare(
      `INSERT INTO photos (id, lead_id, job_id, stage, r2_key, thumb_r2_key, size_bytes, width, height, taken_at, uploaded_at, photo_link_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, to.leadId, jobId ?? null, to.stage, key, thumbKey, clean.bytes.byteLength, clean.width, clean.height, takenAt, now, to.linkId, to.uploadedBy)
    .run()
  return Response.json({ id }, { status: 201 })
}

/** POST /api/public/photos/done?t=… : Pat tapped "I'm done". */
export async function handlePhotoDone(request: Request, env: PhotosEnv, now = Date.now()): Promise<Response> {
  const link = await linkForCredentials(env.DB, credentialsFrom(new URL(request.url)), now)
  if (!link) return text(PHOTO_MESSAGES.expired, 410)
  await env.DB.prepare('UPDATE photo_links SET done_at = coalesce(done_at, ?), last_used_at = ? WHERE id = ?').bind(now, now, link.id).run()
  return Response.json({ ok: true })
}

// ---------------------------------------------------------------------------
// Images

const imageHeaders = (size: number) =>
  new Headers({
    'content-type': 'image/jpeg',
    'content-length': String(size),
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=3600',
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
  })

async function serveImage(bucket: Pick<R2Bucket, 'get'>, row: { r2_key: string; thumb_r2_key: string | null } | null, thumb: boolean) {
  if (!row) return text('Photo not found', 404)
  const object = await bucket.get(thumb && row.thumb_r2_key ? row.thumb_r2_key : row.r2_key)
  if (!object) return text('Photo not found', 404)
  return new Response(object.body, { headers: imageHeaders(object.size) })
}

/** GET /api/public/photos/<id>?t=… : a thumbnail of a photo sent through that same link (Pat's page shows his own). */
export async function handlePublicPhoto(request: Request, env: PhotosEnv, photoId: string, deps: PhotoDeps = {}): Promise<Response> {
  const link = await linkForCredentials(env.DB, credentialsFrom(new URL(request.url)))
  if (!link) return text(PHOTO_MESSAGES.expired, 410)
  const row = await env.DB.prepare('SELECT r2_key, thumb_r2_key FROM photos WHERE id = ? AND photo_link_id = ?')
    .bind(photoId.slice(0, 100), link.id)
    .first<{ r2_key: string; thumb_r2_key: string | null }>()
  return serveImage(deps.bucket ?? env.LEAD_FILES, row, true)
}

/** GET /api/photos/<id>[?size=thumb] : any photo, for signed-in Staff. */
export async function handleStaffPhoto(request: Request, env: PhotosEnv, photoId: string, deps: PhotoDeps = {}): Promise<Response> {
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session) return text('Unauthorized', 401)
  const row = await env.DB.prepare('SELECT r2_key, thumb_r2_key FROM photos WHERE id = ?')
    .bind(photoId.slice(0, 100))
    .first<{ r2_key: string; thumb_r2_key: string | null }>()
  return serveImage(deps.bucket ?? env.LEAD_FILES, row, new URL(request.url).searchParams.get('size') === 'thumb')
}

// ---------------------------------------------------------------------------
// Staff side (photos.functions.ts)

export const photoLinkUrl = (baseUrl: string, token: string) => `${baseUrl.replace(/\/$/, '')}/p/${token}`
export const photoHomeUrl = (baseUrl: string, token: string) => `${baseUrl.replace(/\/$/, '')}/home/${token}`

/** A new Photo link for a Lead or a Job. Returns the link (shown once: only its hash is kept) and a text to send. */
export async function createPhotoLinkRecord(
  d1: D1,
  input: { leadId?: string | null; jobId?: string | null; stage: unknown },
  staffId: string,
  baseUrl: string,
  now = Date.now(),
) {
  if (!isLinkStage(input.stage)) throw new Response('Stage must be before, during or after.', { status: 400 })
  const stage = input.stage
  let leadId: string | null = null
  let jobId: string | null = null
  if (input.jobId) {
    const job = await d1.prepare('SELECT id, lead_id FROM jobs WHERE id = ?').bind(input.jobId).first<{ id: string; lead_id: string | null }>()
    if (!job) throw new Response('Job not found', { status: 404 })
    jobId = job.id
    leadId = job.lead_id
  } else if (input.leadId) {
    const lead = await d1.prepare('SELECT id FROM leads WHERE id = ?').bind(input.leadId).first<string>('id')
    if (!lead) throw new Response('Lead not found', { status: 404 })
    leadId = lead
  } else throw new Response('A Lead or a Job is required.', { status: 400 })

  const token = newToken()
  const id = crypto.randomUUID()
  const expiresAt = now + PHOTO_LINK_MS
  await d1
    .prepare('INSERT INTO photo_links (id, token_hash, lead_id, job_id, stage, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, await hashToken(token), leadId, jobId, stage, staffId, now, expiresAt)
    .run()
  const url = photoLinkUrl(baseUrl, token)
  const title = requestTitle(stage, shortWho(await whoFor(d1, { lead_id: leadId, job_id: jobId })))
  return { id, url, expiresAt, title, message: `${title}. Tap to upload: ${url}` }
}

export async function revokePhotoLinkRecord(d1: D1, linkId: string, now = Date.now()) {
  const r = await d1.prepare('UPDATE photo_links SET revoked_at = coalesce(revoked_at, ?) WHERE id = ? RETURNING id').bind(now, linkId).first()
  if (!r) throw new Response('Photo link not found', { status: 404 })
  return { id: linkId }
}

export type PhotoRow = {
  id: string
  leadId: string | null
  jobId: string | null
  stage: string
  width: number | null
  height: number | null
  takenAt: number | null
  uploadedAt: number
  caption: string | null
  favorite: boolean
  hidden: boolean
}

const PHOTO_SELECT = `SELECT p.id, p.lead_id AS leadId, p.job_id AS jobId, p.stage, p.width, p.height, p.taken_at AS takenAt,
  p.uploaded_at AS uploadedAt, p.caption, p.favorite, p.hidden FROM photos p`

const toPhoto = (r: Record<string, unknown>): PhotoRow => ({ ...(r as PhotoRow), favorite: r.favorite === 1, hidden: r.hidden === 1 })

/** Photos of one Lead, Job or Customer (all of the Customer's Jobs and Leads), oldest first within each stage. */
export async function listPhotoRecords(d1: D1, by: { leadId?: string | null; jobId?: string | null; customerId?: string | null }) {
  let where: string
  let bind: string[]
  if (by.jobId) {
    where = 'p.job_id = ?'
    bind = [by.jobId]
  } else if (by.leadId) {
    // A Lead's own photos plus those already moved to its Jobs.
    where = 'p.lead_id = ? OR p.job_id IN (SELECT id FROM jobs WHERE lead_id = ?)'
    bind = [by.leadId, by.leadId]
  } else if (by.customerId) {
    where = 'p.job_id IN (SELECT id FROM jobs WHERE customer_id = ?) OR p.lead_id IN (SELECT id FROM leads WHERE customer_id = ?)'
    bind = [by.customerId, by.customerId]
  } else throw new Response('A Lead, Job or Customer is required.', { status: 400 })
  const rows = await d1.prepare(`${PHOTO_SELECT} WHERE ${where} ORDER BY coalesce(p.taken_at, p.uploaded_at), p.uploaded_at LIMIT 1000`).bind(...bind).all()
  return rows.results.map(toPhoto)
}

/** Links that still work for a Lead or Job, newest first (to see what is out and turn one off). */
export async function listOpenPhotoLinks(d1: D1, by: { leadId?: string | null; jobId?: string | null }, now = Date.now()) {
  const [col, id] = by.jobId ? ['job_id', by.jobId] : ['lead_id', by.leadId]
  if (!id) throw new Response('A Lead or a Job is required.', { status: 400 })
  const rows = await d1
    .prepare(
      `SELECT l.id, l.stage, l.created_at AS createdAt, l.expires_at AS expiresAt, l.done_at AS doneAt,
         (SELECT count(*) FROM photos p WHERE p.photo_link_id = l.id) AS photoCount
       FROM photo_links l WHERE l.${col} = ? AND l.revoked_at IS NULL AND l.expires_at > ? ORDER BY l.created_at DESC`,
    )
    .bind(id, now)
    .all<{ id: string; stage: LinkStage; createdAt: number; expiresAt: number; doneAt: number | null; photoCount: number }>()
  return rows.results
}

export async function updatePhotoRecord(d1: D1, photoId: string, changes: { favorite?: unknown; hidden?: unknown; caption?: unknown }) {
  const sets: string[] = []
  const bind: unknown[] = []
  for (const k of ['favorite', 'hidden'] as const) {
    if (changes[k] === undefined) continue
    if (typeof changes[k] !== 'boolean') throw new Response(`${k} must be true or false.`, { status: 400 })
    sets.push(`${k} = ?`)
    bind.push(changes[k] ? 1 : 0)
  }
  if (changes.caption !== undefined) {
    if (changes.caption !== null && (typeof changes.caption !== 'string' || changes.caption.length > 500)) throw new Response('Caption is up to 500 characters.', { status: 400 })
    sets.push('caption = ?')
    bind.push(typeof changes.caption === 'string' && changes.caption.trim() ? changes.caption.trim() : null)
  }
  if (!sets.length) throw new Response('Nothing to change.', { status: 400 })
  const r = await d1.prepare(`UPDATE photos SET ${sets.join(', ')} WHERE id = ? RETURNING id`).bind(...bind, photoId).first()
  if (!r) throw new Response('Photo not found', { status: 404 })
  return { id: photoId }
}

/** A Photo home screen for one phone. The link is shown once. */
export async function createPhotoDeviceRecord(d1: D1, name: unknown, staffId: string, baseUrl: string, now = Date.now()) {
  const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : null
  if (!label) throw new Response('Name the phone, e.g. "Pat\'s phone".', { status: 400 })
  const token = newToken()
  const id = crypto.randomUUID()
  await d1
    .prepare('INSERT INTO photo_devices (id, token_hash, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, await hashToken(token), label, staffId, now)
    .run()
  return { id, name: label, url: photoHomeUrl(baseUrl, token) }
}

export async function listPhotoDeviceRecords(d1: D1) {
  const rows = await d1
    .prepare('SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM photo_devices WHERE revoked_at IS NULL ORDER BY created_at DESC')
    .all<{ id: string; name: string; createdAt: number; lastUsedAt: number | null }>()
  return rows.results
}

export async function revokePhotoDeviceRecord(d1: D1, id: string, now = Date.now()) {
  const r = await d1.prepare('UPDATE photo_devices SET revoked_at = coalesce(revoked_at, ?) WHERE id = ? RETURNING id').bind(now, id).first()
  if (!r) throw new Response('Photo home screen not found', { status: 404 })
  return { id }
}

/** Marks a home screen used (shown in Settings so a lost phone can be spotted). */
export async function touchDevice(d1: D1, id: string, now = Date.now()) {
  await d1.prepare('UPDATE photo_devices SET last_used_at = ? WHERE id = ?').bind(now, id).run()
}
