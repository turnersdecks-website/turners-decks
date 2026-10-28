import type { LeadFileKind, LeadFileType } from '#/db/schema'

// Client-safe Quote file vocabulary and checks (GLOSSARY: Quote file, plan 009 decisions 7 and 14). The CHECK
// constraints live in src/db/schema.ts; the upload and download routes in src/lib/lead-files.server.ts.

/** The five Quote file slots, in the order the Quote tab shows them. */
export const LEAD_FILE_LABELS: Record<LeadFileKind, string> = {
  hover_report: 'Hover report',
  materials_list: 'Materials list',
  customer_quote: 'Customer quote',
  signed_quote: 'Signed quote',
  contractor_agreement: 'Contractor agreement',
}
export const LEAD_FILE_SLOTS = Object.keys(LEAD_FILE_LABELS) as LeadFileKind[]

export function isLeadFileKind(value: unknown): value is LeadFileKind {
  return typeof value === 'string' && Object.hasOwn(LEAD_FILE_LABELS, value)
}

/** 25 MiB, the most one Quote file may be (and the CHECK on lead_files.size_bytes). */
export const LEAD_FILE_MAX_BYTES = 26_214_400
/** How much of the start of an upload is read to recognise its type. */
export const SNIFF_PREFIX_BYTES = 4096
export const LEAD_FILE_NAME_MAX = 200

export const LEAD_FILE_EXTENSIONS: Record<LeadFileType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
}

// HEVC-coded HEIF brands. Generic `mif1`/`msf1` alone is not enough: AVIF files carry them too.
const HEVC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'])
const AVIF_BRANDS = new Set(['avif', 'avis'])

const startsWith = (bytes: Uint8Array, magic: number[]) => bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b)
const fourcc = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])

/**
 * The file's type from its first bytes (up to SNIFF_PREFIX_BYTES), or null when it is not a PDF, JPEG, PNG or HEIC.
 * The client's declared type is never trusted.
 */
export function sniffFileType(prefix: Uint8Array): LeadFileType | null {
  if (startsWith(prefix, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf' // %PDF-
  if (startsWith(prefix, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (isHeic(prefix)) return 'image/heic'
  return null
}

/**
 * A structurally valid ISO-BMFF `ftyp` box at offset 0 naming an HEVC brand: size (big-endian u32) at least 16, a
 * multiple of 4 and within the prefix (so 0 = to end of file and 1 = 64-bit size are refused); major brand at 8,
 * compatible brands from 16 to the box end. An `avif`/`avis` major brand is refused even with an HEVC brand listed.
 */
function isHeic(p: Uint8Array): boolean {
  if (p.length < 16) return false
  const size = ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0
  if (size < 16 || size % 4 !== 0 || size > p.length) return false
  if (fourcc(p, 4) !== 'ftyp') return false
  const major = fourcc(p, 8)
  if (AVIF_BRANDS.has(major)) return false
  const brands = [major]
  for (let at = 16; at + 4 <= size; at += 4) brands.push(fourcc(p, at))
  return brands.some((b) => HEVC_BRANDS.has(b))
}

/**
 * The name a Quote file is stored and downloaded under: the basename only, control characters and \ / : * ? " < > |
 * removed, at most 200 characters, its extension set to the sniffed type. Falls back to `<Slot name>.<ext>`.
 */
export function safeFileName(raw: string | null | undefined, type: LeadFileType, kind: LeadFileKind): string {
  const ext = LEAD_FILE_EXTENSIONS[type]
  const base = (raw ?? '').split(/[/\\]/).pop()!
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f-\u009f:*?"<>|]/g, '')
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
  const stem = Array.from(cleaned)
    .slice(0, LEAD_FILE_NAME_MAX - ext.length - 1)
    .join('')
    .trimEnd()
  return `${stem || LEAD_FILE_LABELS[kind]}.${ext}`
}

/**
 * A Content-Disposition value: an ASCII-safe `filename="…"` for old clients plus RFC 5987 `filename*=UTF-8''…` with
 * the real name.
 */
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
