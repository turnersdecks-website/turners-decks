// JPEG helpers shared by Pat's upload page (to read the capture date before the phone re-saves the photo) and the
// server (to remove every metadata segment, so no location ever reaches storage). Pure functions on bytes; no DOM.

const SOI = 0xd8
const SOS = 0xda
const EOI = 0xd9
const APP0 = 0xe0
const APP2 = 0xe2
const COM = 0xfe

/** Start-of-frame markers that carry the image size (not DHT 0xc4, JPG 0xc8 or DAC 0xcc). */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc
/** Markers with no length field. */
const standalone = (m: number) => m === 0x01 || (m >= 0xd0 && m <= 0xd7)

export const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === SOI && b[2] === 0xff

type Segment = { marker: number; start: number; end: number }

/** The header segments up to and including Start of Scan, or null when the bytes are not a well-formed JPEG header. */
function segments(b: Uint8Array): Segment[] | null {
  if (!isJpeg(b)) return null
  const out: Segment[] = []
  let at = 2
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null
    let marker = b[at + 1]
    // Fill bytes (0xFF padding) before a marker are allowed.
    let p = at + 1
    while (marker === 0xff && p + 1 < b.length) marker = b[++p]
    const start = p - 1
    if (standalone(marker)) {
      out.push({ marker, start, end: p + 1 })
      at = p + 1
      continue
    }
    if (marker === EOI || p + 2 >= b.length) return null
    const len = (b[p + 1] << 8) | b[p + 2]
    if (len < 2) return null
    const end = p + 1 + len
    if (end > b.length) return null
    out.push({ marker, start, end })
    if (marker === SOS) return out
    at = end
  }
  return null
}

/**
 * The JPEG with every APPn segment except APP0 (JFIF) and APP2 (ICC colour profile) removed, and comments removed:
 * that takes out Exif (GPS, camera, capture time), XMP and Photoshop blocks. Null when the bytes are not a JPEG this
 * can parse, so the caller refuses the upload rather than storing something unchecked.
 */
export function stripJpegMetadata(b: Uint8Array): { bytes: Uint8Array; width: number | null; height: number | null } | null {
  const segs = segments(b)
  if (!segs) return null
  const sos = segs[segs.length - 1]
  const keep: Uint8Array[] = [b.subarray(0, 2)]
  let width: number | null = null
  let height: number | null = null
  for (const s of segs) {
    const m = s.marker
    if ((m > APP0 && m <= 0xef && m !== APP2) || m === COM) continue
    if (isSof(m) && s.end - s.start >= 9) {
      height = (b[s.start + 5] << 8) | b[s.start + 6]
      width = (b[s.start + 7] << 8) | b[s.start + 8]
    }
    keep.push(b.subarray(s.start, s.end))
  }
  keep.push(b.subarray(sos.end))
  const total = keep.reduce((n, k) => n + k.byteLength, 0)
  const bytes = new Uint8Array(total)
  let at = 0
  for (const k of keep) {
    bytes.set(k, at)
    at += k.byteLength
  }
  return { bytes, width, height }
}

/** True when the JPEG header still holds an Exif or XMP segment (used by tests and as a last check). */
export function hasJpegMetadata(b: Uint8Array): boolean {
  const segs = segments(b)
  if (!segs) return false
  return segs.some((s) => (s.marker > APP0 && s.marker <= 0xef && s.marker !== APP2) || s.marker === COM)
}

export type ExifDate = { year: number; month: number; day: number; hour: number; minute: number; second: number }

/**
 * DateTimeOriginal (else DateTime) from a JPEG's Exif, as the wall-clock parts the camera wrote (Exif has no time
 * zone; the phone turns them into a time in its own zone). Null when there is none or the Exif cannot be read.
 */
export function exifTakenAt(b: Uint8Array): ExifDate | null {
  const segs = segments(b)
  if (!segs) return null
  for (const s of segs) {
    if (s.marker !== 0xe1) continue
    const d = s.start + 4 // after FF E1 and the length
    if (d + 14 > s.end) continue
    if (String.fromCharCode(b[d], b[d + 1], b[d + 2], b[d + 3]) !== 'Exif' || b[d + 4] !== 0 || b[d + 5] !== 0) continue
    const tiff = d + 6
    const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49
    if (!little && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return null
    const u16 = (o: number) => (o + 2 > s.end ? -1 : little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1])
    const u32 = (o: number) =>
      o + 4 > s.end ? -1 : (little ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24) : (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
    const ascii = (ifd: number, tag: number): string | null => {
      const n = u16(tiff + ifd)
      if (n < 0 || n > 500) return null
      for (let i = 0; i < n; i++) {
        const e = tiff + ifd + 2 + i * 12
        if (u16(e) !== tag) continue
        const count = u32(e + 4)
        if (u16(e + 2) !== 2 || count < 19 || count > 64) return null
        const off = tiff + u32(e + 8)
        if (off + 19 > s.end) return null
        return String.fromCharCode(...b.subarray(off, off + 19))
      }
      return null
    }
    const pointer = (ifd: number, tag: number): number | null => {
      const n = u16(tiff + ifd)
      if (n < 0 || n > 500) return null
      for (let i = 0; i < n; i++) {
        const e = tiff + ifd + 2 + i * 12
        if (u16(e) === tag) return u32(e + 8)
      }
      return null
    }
    const ifd0 = u32(tiff + 4)
    if (ifd0 < 0) return null
    const exifIfd = pointer(ifd0, 0x8769)
    const raw = (exifIfd !== null ? ascii(exifIfd, 0x9003) : null) ?? ascii(ifd0, 0x0132)
    const m = raw && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw)
    if (!m) return null
    const [year, month, day, hour, minute, second] = m.slice(1).map(Number)
    if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null
    return { year, month, day, hour, minute, second }
  }
  return null
}
