// The estimator's pricing engine (ADR 0003): the site's former `estimateProject`, moved into the CRM and reading
// every number from a Published version. Pure: no I/O, so intake, replays and tests price identically.
import type { Answers, Section } from './answers'
import { type EstimatorDocument, type QuestionKey, option } from './document'

/** Bumped whenever a formula changes, and stored on every Estimate snapshot. */
export const ENGINE_REVISION = 1

export type ServiceArea = 'primary' | 'edge' | 'outside'

export type LineItems = {
  platform: number
  railing: number
  stairs: number
  landing: number
  demolition: number
  fascia: number
  pattern: number
  skirting: number
  gates: number
  privacy: number
  lighting: number
  features: number
  permit: number
  framing: number
}

export type EstimateResult = {
  sqft: number
  railingLf: number
  lineItems: LineItems
  mid: number
  low: number
  high: number
  belowMinimum: boolean
  flags: string[]
  uncertain: boolean
  serviceArea: ServiceArea
}

export function serviceAreaFor(zip: string, doc: EstimatorDocument): ServiceArea {
  const pre = zip.slice(0, 3)
  if (doc.serviceArea.primaryZipPrefixes.includes(pre)) return 'primary'
  if (doc.serviceArea.edgeZipPrefixes.includes(pre)) return 'edge'
  return 'outside'
}

/** Rounding step by size: under $25k → $500, $25k–$75k → $1,000, over $75k → $2,500. */
export const roundingStep = (n: number) => (n < 25000 ? 500 : n <= 75000 ? 1000 : 2500)
export const roundEstimate = (n: number) => Math.round(n / roundingStep(n)) * roundingStep(n)
const floorStep = (n: number) => Math.floor(n / roundingStep(n)) * roundingStep(n)
const ceilStep = (n: number) => Math.ceil(n / roundingStep(n)) * roundingStep(n)

export const totalSqft = (sections: Section[]) => sections.reduce((s, x) => s + x.width * x.depth, 0)

/** Exposed edge length: section perimeters, minus shared edges and the house wall. */
export function exposedPerimeter(sections: Section[], attached: string | undefined): number {
  if (!sections.length) return 0
  let p = sections.reduce((s, x) => s + 2 * (x.width + x.depth), 0)
  for (const s of sections.slice(1)) p -= 2 * Math.min(s.width, s.depth) // joined to another section
  if (attached === 'yes') p -= Math.max(...sections.map((s) => s.width))
  return Math.max(0, p)
}

/** Questions whose "Not sure" answers make an estimate uncertain (a wider range). */
const UNSURE_COUNTED: QuestionKey[] = [
  'attached', 'height', 'layout', 'slope', 'access', 'material', 'railingSides', 'railingStyle',
  'stairType', 'landing', 'demolition', 'skirting', 'lighting', 'privacyWall',
]

/** Prices validated answers (`parseAnswers`) against a validated document (`validateDocument`). */
export function estimate(doc: EstimatorDocument, a: Answers): EstimateResult {
  const price = (key: QuestionKey, field: string): number => {
    const v = a[key as keyof Answers]
    return typeof v === 'string' ? (option(doc, key, v).price[field] ?? 0) : 0
  }
  const p = doc.prices
  const redeck = a.projectType === 'redeck'
  const sqft = totalSqft(a.sections)
  const edge = exposedPerimeter(a.sections, a.attached)
  const heightMult = price('height', 'multiplier')

  // 1–4. Platform with structural multipliers (a redeck reuses the structure: half the height uplift)
  const rate = price('material', redeck ? 'redeckPerSqft' : 'newPerSqft')
  const hMult = redeck ? 1 + (heightMult - 1) / 2 : heightMult
  let platform = sqft * rate * hMult * price('layout', 'multiplier') * price('access', 'multiplier')
  if (a.projectType === 'expansion') platform *= 1 + p.expansionIntegration

  // 5. Railings
  const hasStairs = a.stairType !== undefined && a.stairType !== 'none'
  const stairCount = hasStairs ? Number(a.stairCount) : 0
  const openings = stairCount * p.stairOpeningLf
  const railingLf =
    a.railingSides === undefined || a.railingSides === 'none'
      ? 0
      : Math.max(0, Math.round(a.railingLf ?? edge * price('railingSides', 'share') - openings))
  const railRate = price('railingStyle', 'perLf')
  const railing = railingLf * railRate

  // 6–7. Stairs and landings
  let stairs = 0
  let landing = 0
  if (hasStairs) {
    const per =
      price('stairType', 'base') +
      price('stairType', 'railLfPerSide') * (a.stairRails === 'both' ? 2 : 1) * railRate +
      (a.closedRisers ? price('stairType', 'risers') * p.closedRiserPerRiser : 0)
    stairs = per * stairCount
    if (a.landing !== undefined && a.landing !== 'none') {
      const n = a.landing === 'multiple' ? 2 : 1
      landing = n * (p.landingSqft * price('material', 'newPerSqft') * p.landingStructureFactor * heightMult + p.landingRailLf * railRate)
    }
  }

  // 8. Demolition (a redeck always removes the old boards; a replacement always removes the old deck)
  let demolition = price('demolition', 'price')
  const demoPrice = (v: string) => option(doc, 'demolition', v).price.price ?? 0
  if (redeck && a.demolition !== 'homeowner') demolition = Math.max(demolition, demoPrice('deckingOnly'))
  if (a.projectType === 'replacement' && a.demolition === 'none') demolition = demoPrice('full')

  // 9. Fascia + patterns
  const fascia = edge * price('fascia', 'perLf')
  const pattern = platform * price('pattern', 'pct')

  // 10. Skirting
  let skirting = 0
  if (a.skirting !== undefined && a.skirting !== 'none') {
    const lf = edge * (a.skirtingCoverage === 'full' ? 1 : p.skirtingPartialShare)
    skirting = lf * price('height', 'skirtingHeightFt') * price('skirting', 'perSqft') + (a.skirtingDoor ? p.skirtingAccessDoor : 0)
  }

  // 11–12. Gates, privacy, lighting, features
  const gates = Number(a.gates ?? 0) * p.gateEach
  const privacy = price('privacyWall', 'lf') * p.privacyWallPerLf
  const lighting = price('lighting', 'price')
  const features = a.features.reduce((s, f) => s + (option(doc, 'features', f).price.price ?? 0), 0)

  // 13–14. Permit + redeck framing allowance
  const permit = p.permitAllowance
  const framing = redeck ? platform * p.redeckFramingContingency : 0

  const lineItems: LineItems = { platform, railing, stairs, landing, demolition, fascia, pattern, skirting, gates, privacy, lighting, features, permit, framing }
  let mid = Math.round(Object.values(lineItems).reduce((x, y) => x + y, 0) * (1 + p.markupPercent))

  // 17. Minimum
  const belowMinimum = mid < p.minimumProjectPrice
  if (belowMinimum) mid = p.minimumProjectPrice

  // Site-review flags: the chosen options' flags, in question order, each once; plus the service area.
  const serviceArea = serviceAreaFor(a.zip, doc)
  const flags: string[] = []
  for (const q of doc.questions) {
    const v = a[q.key as keyof Answers]
    const chosen = typeof v === 'string' ? [v] : q.key === 'features' ? a.features : []
    for (const value of chosen) {
      const f = q.options?.find((o) => o.value === value)?.reviewFlag
      if (f && !flags.includes(f)) flags.push(f)
    }
  }
  if (serviceArea === 'outside') flags.push('Outside the normal service area')

  const unsureCount = UNSURE_COUNTED.filter((k) => a[k as keyof Answers] === 'unsure').length
  const uncertain = unsureCount >= 2

  const [lo, hi] = flags.length ? doc.ranges.review : uncertain ? doc.ranges.uncertain : doc.ranges.standard
  // Clamped around the midpoint (PLAN.md, Codex round 3): low never above, high never below, whatever the spreads.
  const low = Math.max(Math.min(roundEstimate(mid * lo), floorStep(mid)), p.minimumProjectPrice)
  const high = Math.max(roundEstimate(mid * hi), ceilStep(mid))

  return { sqft, railingLf, lineItems, mid, low, high, belowMinimum, flags, uncertain, serviceArea }
}

/** True when a result is safe to store and show (PLAN.md "Output guard"). */
export const isSaneResult = (r: EstimateResult) =>
  [r.low, r.mid, r.high, ...Object.values(r.lineItems)].every(Number.isFinite) && r.low > 0 && r.low <= r.mid && r.mid <= r.high
