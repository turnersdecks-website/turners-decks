import { exifTakenAt } from '#/lib/jpeg'
import { PHOTO_MAX_EDGE, PHOTO_THUMB_EDGE } from '#/lib/photo-vocab'

// Browser side of Pat's upload page: read the capture time, then re-draw the photo smaller. Drawing to a canvas and
// saving a new JPEG drops all metadata (GPS included) before anything leaves the phone; the server strips again.

async function draw(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This phone could not prepare the photo.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  canvas.width = canvas.height = 0
  if (!blob) throw new Error('This phone could not prepare the photo.')
  return blob
}

export type PreparedPhoto = { photo: Blob; thumb: Blob; takenAt: number | null }

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let takenAt: number | null = null
  try {
    // Exif sits near the start; 256 KiB covers it on phones.
    const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
    const d = exifTakenAt(head)
    // Exif time has no zone: read it as the phone's own local time.
    if (d) takenAt = new Date(d.year, d.month - 1, d.day, d.hour, d.minute, d.second).getTime()
  } catch {
    takenAt = null
  }
  // createImageBitmap applies the photo's rotation, so portrait shots stay upright after the metadata is gone.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const photo = await draw(bitmap, PHOTO_MAX_EDGE, 0.86)
    const thumb = await draw(bitmap, PHOTO_THUMB_EDGE, 0.8)
    return { photo, thumb, takenAt: takenAt ?? (file.lastModified || null) }
  } finally {
    bitmap.close()
  }
}
