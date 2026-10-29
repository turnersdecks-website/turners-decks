import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { requireAdmin, requireStaff } from '#/lib/guards'
import { record, requiredId } from '#/lib/input'
import {
  createPhotoDeviceRecord,
  createPhotoLinkRecord,
  deviceForToken,
  linkForCredentials,
  listOpenPhotoLinks,
  listPhotoDeviceRecords,
  listPhotoRecords,
  photoHomeView,
  photoRequestView,
  revokePhotoDeviceRecord,
  revokePhotoLinkRecord,
  touchDevice,
  updatePhotoRecord,
} from '#/lib/photos.server'

// Photos (GLOSSARY Photo, Photo link, Photo home screen). The work is in photos.server.ts. Staff functions need a
// session; the three public ones behind Pat's pages need only a working link or home screen token.

const optionalId = (v: unknown) => (v === undefined || v === null || v === '' ? null : requiredId(v))

export const createPhotoLink = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { leadId?: string | null; jobId?: string | null; stage: string }) => record(data))
  .handler(({ data, context: { staff } }) =>
    createPhotoLinkRecord(env.DB, { leadId: optionalId(data.leadId), jobId: optionalId(data.jobId), stage: data.stage }, staff.id, env.BETTER_AUTH_URL),
  )

export const revokePhotoLink = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { linkId: string }) => record(data))
  .handler(({ data }) => revokePhotoLinkRecord(env.DB, requiredId(data.linkId)))

export const listPhotoLinks = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { leadId?: string | null; jobId?: string | null }) => record(data))
  .handler(({ data }) => listOpenPhotoLinks(env.DB, { leadId: optionalId(data.leadId), jobId: optionalId(data.jobId) }))

export const listPhotos = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { leadId?: string | null; jobId?: string | null; customerId?: string | null }) => record(data))
  .handler(({ data }) => listPhotoRecords(env.DB, { leadId: optionalId(data.leadId), jobId: optionalId(data.jobId), customerId: optionalId(data.customerId) }))

export const updatePhoto = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { photoId: string; favorite?: boolean; hidden?: boolean; caption?: string | null }) => record(data))
  .handler(({ data }) => updatePhotoRecord(env.DB, requiredId(data.photoId), data))

export const createPhotoDevice = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { name: string }) => record(data))
  .handler(({ data, context: { staff } }) => createPhotoDeviceRecord(env.DB, data.name, staff.id, env.BETTER_AUTH_URL))

export const listPhotoDevices = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(() => listPhotoDeviceRecords(env.DB))

export const revokePhotoDevice = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { id: string }) => record(data))
  .handler(({ data }) => revokePhotoDeviceRecord(env.DB, requiredId(data.id)))

// ---------------------------------------------------------------------------
// Public: Pat's pages. A bad, expired or turned-off token returns null (the page says so), never an error with detail.

export const getPhotoRequest = createServerFn({ method: 'GET' })
  .validator((data: { t?: string; d?: string; l?: string }) => record(data))
  .handler(async ({ data }) => {
    const link = await linkForCredentials(env.DB, data)
    return link ? photoRequestView(env.DB, link) : null
  })

export const getPhotoHome = createServerFn({ method: 'GET' })
  .validator((data: { d: string }) => record(data))
  .handler(async ({ data }) => {
    const device = await deviceForToken(env.DB, data.d)
    if (!device) return null
    await touchDevice(env.DB, device.id)
    return { name: device.name, requests: await photoHomeView(env.DB) }
  })
