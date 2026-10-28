// Address equality (plan 006 D1/D3). "Same address" everywhere means equal addressKey(), never equal text:
// normalized street + unit + zip5 (lowercase, punctuation removed, whitespace collapsed, USPS suffix and directional
// abbreviations, unit markers apt/unit/#/ste unified). No street -> no key. Pure, shared by client and server.

const ABBREVIATIONS: Record<string, string> = {
  // USPS street suffixes
  street: 'st', avenue: 'ave', av: 'ave', road: 'rd', lane: 'ln', drive: 'dr', court: 'ct', circle: 'cir',
  boulevard: 'blvd', place: 'pl', terrace: 'ter', highway: 'hwy', parkway: 'pkwy', square: 'sq', trail: 'trl',
  way: 'way', point: 'pt', heights: 'hts', extension: 'ext', crossing: 'xing', route: 'rte', mountain: 'mtn',
  hill: 'hl', ridge: 'rdg', cove: 'cv', harbor: 'hbr', island: 'is', landing: 'lndg', meadow: 'mdw', meadows: 'mdws',
  // directionals
  north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
}

/** Words that introduce a unit; all become `#`. */
const UNIT_MARKERS = new Set(['apt', 'apartment', 'unit', 'ste', 'suite', '#'])

/** Lowercase tokens with punctuation removed (`#` kept as its own token). */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/#/g, ' # ')
    .replace(/[^a-z0-9# ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** "12 Ocean Avenue Apt 2" -> { street: '12 ocean ave', unit: '2' }. */
function splitUnit(words: string[]): { street: string[]; unit: string | null } {
  // The first unit marker after the house number ends the street; what follows is the unit.
  const at = words.findIndex((w, i) => i > 0 && UNIT_MARKERS.has(w) && (w === '#' || i < words.length - 1))
  if (at === -1) return { street: words, unit: null }
  const unit = words.slice(at + 1).filter((w) => !UNIT_MARKERS.has(w)).join('')
  return { street: words.slice(0, at), unit: unit || null }
}

/** Unit text from a separate unit field ("Apt 2", "#2", "2") -> "2". */
function unitValue(unit: string | null | undefined): string | null {
  const words = tokens(unit ?? '').filter((w) => !UNIT_MARKERS.has(w))
  return words.length ? words.join('') : null
}

export type AddressParts = { street: string | null | undefined; unit?: string | null; zip: string | null | undefined }

/** The normalized key of an address, or null when there is no street. */
export function addressKey({ street, unit, zip }: AddressParts): string | null {
  const split = splitUnit(tokens(street ?? ''))
  const streetWords = split.street.map((w) => ABBREVIATIONS[w] ?? w)
  if (!streetWords.length) return null
  const u = unitValue(unit) ?? split.unit
  const zip5 = (zip ?? '').replace(/\D/g, '').slice(0, 5)
  return `${streetWords.join(' ')}${u ? ` #${u}` : ''}|${zip5}`
}

/** The key of a full address as `fullAddress` writes it ("street, city, ST zip"); null when none. */
export function addressKeyOfText(text: string | null | undefined): string | null {
  if (!text) return null
  const parts = text.split(',').map((p) => p.trim())
  const zip = parts.length > 1 ? (parts[parts.length - 1].match(/(\d{5})(?:-\d{4})?$/)?.[1] ?? null) : null
  return addressKey({ street: parts[0], zip })
}

/** A unit with its marker: kept when it starts with one ("Apt B", "#2"), else `#` in front ("2", "B" -> "#2", "#B"). */
function withMarker(u: string): string {
  const [first, ...rest] = tokens(u)
  return UNIT_MARKERS.has(first) && rest.length ? u : `#${u}`
}

/** The street with its unit, as one line ("12 Ocean Ave #2"); a bare unit ("2", "B") gets a `#` marker. */
export function streetLine(street: string | null | undefined, unit: string | null | undefined): string | null {
  const s = street?.trim()
  if (!s) return null
  const u = unit?.trim()
  return u ? `${s} ${withMarker(u)}` : s
}

/** A unit as stored: with its marker, so `street || ' ' || unit` reads as one street line ("2" -> "#2", "B" -> "#B"). */
export function normalizeUnit(unit: string | null): string | null {
  const u = unit?.trim()
  return u ? withMarker(u) : null
}
