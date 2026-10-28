import { describe, expect, it } from 'vitest'
import { parseAnswers } from '#/lib/estimator/answers'
import { type EstimatorDocument, validateDocument } from '#/lib/estimator/document'
import { estimate, isSaneResult, roundEstimate } from '#/lib/estimator/engine'
import { STEPS } from '#/lib/estimator/relevance'
import { validateSettings } from '#/lib/estimator/public'
import { SEED_DOCUMENT } from '#/lib/estimator/seed'

// FLW-199: the site's pricing tests (src/lib/pricing.test.ts), now against Published version 1's document.
const base = {
  projectType: 'replacement', shape: 'rectangle', sections: [{ width: 20, depth: 16 }], attached: 'yes',
  height: 'low', layout: 'rectangle', slope: 'flat', access: 'standard', townhouse: 'no', zip: '19518',
  hoa: 'no', historic: 'no', material: 'standardComposite', railingSides: 'three', railingLf: 35,
  railingStyle: 'whiteVinyl', gates: '0', privacyWall: 'none', stairType: 'standard', stairCount: '1',
  stairRails: 'one', closedRisers: false, landing: 'none', demolition: 'full', fascia: 'standard',
  pattern: 'standard', skirting: 'none', lighting: 'none', features: [], neighbors: 'no',
} as Record<string, unknown>

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

function price(overrides: Record<string, unknown> = {}, doc: EstimatorDocument = SEED_DOCUMENT) {
  const parsed = parseAnswers(doc, { ...base, ...overrides })
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors))
  return estimate(doc, parsed.answers)
}

describe('pricing a deck against Published version 1', () => {
  it('prices the brief’s 320 sq ft composite replacement at $38,000–$47,000', () => {
    const r = price()
    expect(r.sqft).toBe(320)
    expect(r.mid).toBe(42285)
    expect([r.low, r.high]).toEqual([38000, 47000])
    expect(r.flags).toEqual([])
  })

  it('never shows less than the $10,000 minimum', () => {
    const r = price({ projectType: 'new', sections: [{ width: 8, depth: 8 }], material: 'pressureTreated', height: 'ground', railingSides: 'none', stairType: 'none', demolition: 'none' })
    expect(r.belowMinimum).toBe(true)
    expect(r.low).toBe(10000)
  })

  it('never shows a low end under the minimum, even just above it', () => {
    const r = price({ projectType: 'new', sections: [{ width: 10, depth: 10 }], material: 'pressureTreated', height: 'ground', railingSides: 'none', stairType: 'none', demolition: 'none', lighting: 'stairs', features: ['drinkRail', 'bench'] })
    expect(r.belowMinimum).toBe(false)
    expect(r.mid * 0.9).toBeLessThan(10000)
    expect(r.low).toBe(10000)
  })

  it('always prices removal on a full replacement', () => {
    expect(price({ demolition: 'none' }).lineItems.demolition).toBe(3250)
  })

  it('flags townhouses and HOA properties for site review', () => {
    expect(price({ townhouse: 'yes' }).flags).toContain('Townhouse or attached home')
    expect(price({ access: 'townhouse' }).flags).toContain('Townhouse or attached home')
    expect(price({ hoa: 'yes' }).flags).toContain('HOA approval may be required')
  })

  it('lists a flag once even when two answers raise it', () => {
    expect(price({ townhouse: 'yes', access: 'townhouse' }).flags).toEqual(['Townhouse or attached home'])
  })

  it('drops demolition when the homeowner removes the old deck', () => {
    expect(price({ demolition: 'homeowner' }).lineItems.demolition).toBe(0)
  })

  it('adds no stair, stair-railing or landing cost without stairs', () => {
    const r = price({ stairType: 'none', landing: 'top' })
    expect(r.lineItems.stairs).toBe(0)
    expect(r.lineItems.landing).toBe(0)
  })

  it('adds a 10% framing allowance on redecks', () => {
    const r = price({ projectType: 'redeck', framingSound: 'yes', rot: 'no', unstable: 'no' })
    expect(r.lineItems.framing).toBeCloseTo(r.lineItems.platform * 0.1)
  })

  it('flags a redeck with rot or unknown framing', () => {
    expect(price({ projectType: 'redeck', framingSound: 'unsure', rot: 'yes', unstable: 'no' }).flags).toEqual([
      'Existing framing condition unknown',
      'Visible rot in existing framing',
    ])
  })

  it('flags decks over 10 ft for manual review and widens the range to 80–125%', () => {
    const r = price({ height: 'high' })
    expect(r.flags).toContain('Deck more than 10 feet high')
    expect(r.low).toBe(roundEstimate(r.mid * 0.8))
    expect(r.high).toBe(roundEstimate(r.mid * 1.25))
  })

  it('flags a ZIP outside the service area', () => {
    expect(price({ zip: '10001' }).flags).toContain('Outside the normal service area')
    expect(price({ zip: '19518' }).serviceArea).toBe('primary')
    expect(price({ zip: '19103' }).serviceArea).toBe('edge')
  })

  it('rounds to $500 under $25k, $1,000 to $75k, $2,500 above', () => {
    expect(roundEstimate(18240)).toBe(18000)
    expect(roundEstimate(38600)).toBe(39000)
    expect(roundEstimate(81000)).toBe(80000)
  })

  it('prices stair rails at the railing style when the deck has no railings', () => {
    const r = price({ railingSides: 'none', railingStyle: 'composite' })
    expect(r.lineItems.railing).toBe(0)
    expect(r.lineItems.stairs).toBe(2500 + 8 * 185)
  })
})

describe('an option the owner added', () => {
  it('is priced from its own fields and raises its own review flag', () => {
    const doc = clone(SEED_DOCUMENT)
    doc.questions
      .find((q) => q.key === 'material')!
      .options!.push({ value: 'ipe', label: 'Ipe hardwood', enabled: true, reviewFlag: 'Hardwood: confirm supply', price: { newPerSqft: 120, redeckPerSqft: 60 } })
    expect(validateSettings(doc).ok).toBe(true)
    const r = price({ material: 'ipe' }, doc)
    expect(r.lineItems.platform).toBeCloseTo(320 * 120 * 1.05)
    expect(r.flags).toEqual(['Hardwood: confirm supply'])
  })

  it('cannot be chosen once it is turned off', () => {
    const doc = clone(SEED_DOCUMENT)
    doc.questions.find((q) => q.key === 'material')!.options!.find((o) => o.value === 'pvc')!.enabled = false
    const parsed = parseAnswers(doc, { ...base, material: 'pvc' })
    expect(parsed.ok).toBe(false)
  })
})

describe('the range always brackets the midpoint', () => {
  // Codex plan review round 3: any publishable spreads and minimum keep low ≤ mid ≤ high.
  const tight = (minimum: number) => {
    const doc = clone(SEED_DOCUMENT)
    doc.ranges = { standard: [0.95, 1.05], uncertain: [0.95, 1.05], review: [0.95, 1.05] }
    doc.prices.minimumProjectPrice = minimum
    return doc
  }
  const sizes = [[3, 3], [8, 8], [12, 12], [16, 16], [20, 20], [24, 24], [30, 30], [40, 40], [60, 60], [100, 100]]

  it.each([1000, 10000])('holds at the tightest spreads with a $%i minimum, across rounding steps', (minimum) => {
    const doc = tight(minimum)
    for (const [width, depth] of sizes) {
      for (const material of ['pressureTreated', 'pvc']) {
        const r = price({ sections: [{ width, depth }], material }, doc)
        expect(isSaneResult(r), `${width}×${depth} ${material}: ${r.low}/${r.mid}/${r.high}`).toBe(true)
      }
    }
  })

  it('holds with fractional unit prices', () => {
    const doc = tight(1000)
    doc.questions.find((q) => q.key === 'material')!.options!.find((o) => o.value === 'pvc')!.price.newPerSqft = 0.37
    const r = price({ material: 'pvc', railingSides: 'none', stairType: 'none' }, doc)
    expect(isSaneResult(r)).toBe(true)
  })
})

describe('answers the CRM refuses', () => {
  const errorsFor = (overrides: Record<string, unknown>) => {
    const parsed = parseAnswers(SEED_DOCUMENT, { ...base, ...overrides })
    return parsed.ok ? {} : parsed.errors
  }

  it('refuses sizes outside 3–100 ft, no sections, or more than five', () => {
    expect(errorsFor({ sections: [{ width: 2, depth: 10 }] })).toHaveProperty('sections')
    expect(errorsFor({ sections: [] })).toHaveProperty('sections')
    expect(errorsFor({ sections: Array(6).fill({ width: 10, depth: 10 }) })).toHaveProperty('sections')
    expect(errorsFor({ sections: [{ width: Number.NaN, depth: 10 }] })).toHaveProperty('sections')
  })

  it('refuses a feature twice, an unknown feature, and an unknown question', () => {
    expect(errorsFor({ features: ['bench', 'bench'] })).toHaveProperty('features')
    expect(errorsFor({ features: ['moat'] })).toHaveProperty('features')
    expect(errorsFor({ moat: 'yes' })).toHaveProperty('_')
  })

  it('refuses a missing answer to a question that was shown', () => {
    expect(errorsFor({ material: undefined })).toHaveProperty('material')
    expect(errorsFor({ zip: '1951' })).toHaveProperty('zip')
    expect(errorsFor({ railingLf: 0 })).toHaveProperty('railingLf')
  })

  it('ignores answers to questions that were not shown', () => {
    const parsed = parseAnswers(SEED_DOCUMENT, { ...base, stairType: 'none', stairCount: 'lots', framingSound: 'no' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.answers).not.toHaveProperty('stairCount')
      expect(parsed.answers).not.toHaveProperty('framingSound')
    }
  })

  it('records which shown answers were left on their default', () => {
    const doc = clone(SEED_DOCUMENT)
    doc.questions.find((q) => q.key === 'attached')!.default = 'yes'
    const parsed = parseAnswers(doc, base, ['attached', 'material', 'stairCount'])
    expect(parsed.ok && parsed.defaulted).toEqual(['attached'])
  })
})

describe('settings the owner cannot publish', () => {
  const errorsFor = (edit: (d: EstimatorDocument) => void) => {
    const doc = clone(SEED_DOCUMENT)
    edit(doc)
    const v = validateSettings(doc)
    return v.ok ? {} : v.fieldErrors
  }
  const qi = (key: string) => SEED_DOCUMENT.questions.findIndex((q) => q.key === key)

  it('accepts Published version 1 as seeded', () => {
    expect(validateDocument(SEED_DOCUMENT).ok).toBe(true)
    expect(validateSettings(SEED_DOCUMENT).ok).toBe(true)
  })

  it('refuses a negative or missing price', () => {
    expect(Object.keys(errorsFor((d) => (d.questions[qi('railingStyle')]!.options![0]!.price.perLf = -1)))).toContain(`questions.${qi('railingStyle')}.options.0.price.perLf`)
    expect(Object.keys(errorsFor((d) => delete d.questions[qi('material')]!.options![0]!.price.newPerSqft))).toContain(`questions.${qi('material')}.options.0.price.newPerSqft`)
  })

  it('refuses an empty label and a duplicate option value', () => {
    expect(errorsFor((d) => (d.questions[0]!.label = '  '))).toHaveProperty('questions.0.label')
    expect(errorsFor((d) => (d.questions[qi('fascia')]!.options![1]!.value = 'standard'))).toHaveProperty(`questions.${qi('fascia')}.options.1.value`)
  })

  it('refuses removing an option the engine needs, or adding one to a locked question', () => {
    expect(errorsFor((d) => (d.questions[qi('stairType')]!.options = d.questions[qi('stairType')]!.options!.filter((o) => o.value !== 'none')))).toHaveProperty(`questions.${qi('stairType')}.options`)
    expect(
      errorsFor((d) => d.questions[qi('projectType')]!.options!.push({ value: 'gazebo', label: 'Gazebo', enabled: true, price: {} })),
    ).toHaveProperty(`questions.${qi('projectType')}.options`)
  })

  it('refuses a question with every option off, or a default that is off', () => {
    expect(errorsFor((d) => d.questions[qi('fascia')]!.options!.forEach((o) => (o.enabled = false)))).toHaveProperty(`questions.${qi('fascia')}.options`)
    expect(
      errorsFor((d) => {
        d.questions[qi('fascia')]!.default = 'premium'
        d.questions[qi('fascia')]!.options![1]!.enabled = false
      }),
    ).toHaveProperty(`questions.${qi('fascia')}.default`)
  })

  it('refuses spreads tighter than 5%, a review range narrower than standard, and an odd minimum', () => {
    expect(errorsFor((d) => (d.ranges.standard = [0.97, 1.1]))).toHaveProperty('ranges.standard.0')
    expect(errorsFor((d) => (d.ranges.review = [0.9, 1.1]))).toHaveProperty('ranges')
    expect(errorsFor((d) => (d.prices.minimumProjectPrice = 10250))).toHaveProperty('prices.minimumProjectPrice')
    expect(errorsFor((d) => (d.prices.minimumProjectPrice = 500))).toHaveProperty('prices.minimumProjectPrice')
  })
})

describe('the step layout', () => {
  it('only shows a question based on answers from the same or an earlier step, to always-shown questions', () => {
    const stepOf = new Map<string, number>()
    STEPS.forEach((items, i) => items.forEach((it) => !it.showIf && !stepOf.has(it.key) && stepOf.set(it.key, i)))
    STEPS.forEach((items, i) =>
      items.forEach((it) =>
        (it.showIf ?? []).forEach((c) => {
          expect(stepOf.get(c.question), `${it.key} depends on ${c.question}`).toBeLessThanOrEqual(i)
        }),
      ),
    )
  })
})
