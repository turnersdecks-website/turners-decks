// US phone helpers, safe for the browser and the Worker (ported from Lovable `lib/phone.ts`).

/** US numbers only: 10 digits, or 11 starting with 1. */
export function toE164(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

/** "+16105550100" -> "(610) 555-0100"; anything else as given. */
export function prettyPhone(e164: string | null | undefined) {
  const d = (e164 ?? '').replace(/\D/g, '').replace(/^1/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (e164 ?? '')
}
