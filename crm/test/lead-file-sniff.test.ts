import { describe, expect, it } from 'vitest'
import { contentDisposition, safeFileName, sniffFileType } from '#/lib/lead-files'

// Quote file type sniffing (plan 009 decision 14). Fixtures in test/fixtures/lead-files/ (base64, `.b64`) are the
// first 4 KiB of files written by real encoders: iphone.heic by Apple's ImageIO HEIC encoder (the iPhone's), photo.avif by ImageIO's AVIF
// encoder, one-page.pdf / photo.jpg / image.png likewise. generic-mif1.heif is iphone.heic with its HEVC brands
// rewritten to the generic `mif1`/`miaf` (what a non-HEVC HEIF such as AVIF also carries).

const fixtures = import.meta.glob<string>('./fixtures/lead-files/*.b64', { query: '?raw', import: 'default', eager: true })
function fixture(name: string): Uint8Array {
  const b64 = fixtures[`./fixtures/lead-files/${name}.b64`]
  if (!b64) throw new Error(`no fixture ${name}`)
  return Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0))
}

const ascii = (s: string) => new TextEncoder().encode(s)
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
/** An `ftyp` box: size, 'ftyp', major brand, minor version 0, compatible brands; padded with `pad` bytes after it. */
function ftyp(major: string, compatible: string[], { size, pad = 64 }: { size?: number; pad?: number } = {}) {
  const body = [...ascii(major), 0, 0, 0, 0, ...compatible.flatMap((b) => [...ascii(b)])]
  return new Uint8Array([...u32(size ?? 8 + body.length), ...ascii('ftyp'), ...body, ...new Array(pad).fill(0)])
}

describe('sniffFileType', () => {
  it.each([
    ['one-page.pdf', 'application/pdf'],
    ['photo.jpg', 'image/jpeg'],
    ['image.png', 'image/png'],
    ['iphone.heic', 'image/heic'],
  ])('recognises %s', (name, type) => {
    expect(sniffFileType(fixture(name))).toBe(type)
  })

  it('refuses a real AVIF and a generic mif1-only HEIF', () => {
    expect(sniffFileType(fixture('photo.avif'))).toBeNull()
    expect(sniffFileType(fixture('generic-mif1.heif'))).toBeNull()
  })

  it('refuses an avif major brand even with heic listed as compatible', () => {
    expect(sniffFileType(ftyp('avif', ['mif1', 'heic']))).toBeNull()
    expect(sniffFileType(ftyp('avis', ['msf1', 'hevc']))).toBeNull()
  })

  it('accepts heic only as a compatible brand', () => {
    const iphone = fixture('iphone.heic').slice()
    iphone.set(ascii('mif1'), 8) // major brand heic -> mif1; heic stays in the compatible list
    expect(sniffFileType(iphone)).toBe('image/heic')
    expect(sniffFileType(ftyp('mif1', ['miaf', 'heix']))).toBe('image/heic')
  })

  it.each([
    ['size 0 (to end of file)', 0],
    ['size 1 (64-bit size)', 1],
    ['size 12', 12],
    ['size not a multiple of 4', 26],
    ['size larger than the prefix', 4000],
  ])('refuses an ftyp box with %s', (_label, size) => {
    expect(sniffFileType(ftyp('heic', ['mif1', 'heic'], { size }))).toBeNull()
  })

  it('refuses a truncated box (the prefix ends inside it)', () => {
    const box = ftyp('mif1', ['miaf', 'heic'], { pad: 0 })
    expect(sniffFileType(box)).toBe('image/heic')
    expect(sniffFileType(box.subarray(0, box.length - 4))).toBeNull()
  })

  it.each([
    ['SVG', ascii('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['HTML', ascii('<!doctype html><html><body>hi</body></html>')],
    ['%PDF not at offset 0', ascii(' %PDF-1.7\n')],
    ['GIF', ascii('GIF89a\x01\x00\x01\x00')],
    ['ZIP / Office', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])],
    ['empty input', new Uint8Array()],
    ['4-byte input', new Uint8Array([0x00, 0x00, 0x00, 0x18])],
  ])('refuses %s', (_label, bytes) => {
    expect(sniffFileType(bytes)).toBeNull()
  })
})

describe('safeFileName', () => {
  it('keeps only the basename (no path traversal)', () => {
    expect(safeFileName('../../etc/passwd.pdf', 'application/pdf', 'signed_quote')).toBe('passwd.pdf')
    expect(safeFileName('C:\\Users\\aaron\\Quote.pdf', 'application/pdf', 'customer_quote')).toBe('Quote.pdf')
  })

  it('strips control characters and \\ / : * ? " < > |', () => {
    expect(safeFileName('Smith\u0000\u001f\u007f "roof" <final>?*|:.pdf', 'application/pdf', 'signed_quote')).toBe('Smith roof final.pdf')
  })

  it('cuts a long name to 200 characters, extension included', () => {
    const name = safeFileName(`${'a'.repeat(300)}.pdf`, 'application/pdf', 'hover_report')
    expect(name).toHaveLength(200)
    expect(name.endsWith('a.pdf')).toBe(true)
  })

  it('sets the extension to the sniffed type', () => {
    expect(safeFileName('quote.svg', 'application/pdf', 'customer_quote')).toBe('quote.pdf')
    expect(safeFileName('IMG_0042.HEIC', 'image/heic', 'materials_list')).toBe('IMG_0042.heic')
    expect(safeFileName('scan', 'image/png', 'materials_list')).toBe('scan.png')
  })

  it("falls back to the slot's name", () => {
    expect(safeFileName(null, 'application/pdf', 'contractor_agreement')).toBe('Contractor agreement.pdf')
    expect(safeFileName('../..', 'image/jpeg', 'hover_report')).toBe('Hover report.jpg')
    expect(safeFileName('<>.pdf', 'application/pdf', 'signed_quote')).toBe('Signed quote.pdf')
  })
})

describe('contentDisposition', () => {
  it('quotes safely and carries the real name in filename*', () => {
    expect(contentDisposition('inline', 'Smith "final" quote.pdf')).toBe(
      `inline; filename="Smith _final_ quote.pdf"; filename*=UTF-8''Smith%20%22final%22%20quote.pdf`,
    )
  })

  it('keeps non-ASCII names in filename* only', () => {
    expect(contentDisposition('attachment', 'Devis Hélène – toit.pdf')).toBe(
      `attachment; filename="Devis H_l_ne _ toit.pdf"; filename*=UTF-8''Devis%20H%C3%A9l%C3%A8ne%20%E2%80%93%20toit.pdf`,
    )
  })
})
