// The Estimator settings document (ADR 0003, FLW-199): every price, label, option and disclaimer the estimator uses.
// Published versions are frozen copies of it. The pricing formulas stay in `engine.ts`; this document only supplies
// numbers and words. Validation here runs on save and on publish, so a published document can always be priced.
import { z } from 'zod'

/** Every estimator question, fixed in code. The owner edits their wording and options, never the set itself. */
export const QUESTION_KEYS = [
  'projectType',
  'shape',
  'sections',
  'attached',
  'layout',
  'height',
  'slope',
  'access',
  'townhouse',
  'zip',
  'hoa',
  'historic',
  'material',
  'railingSides',
  'railingLf',
  'railingStyle',
  'gates',
  'privacyWall',
  'stairType',
  'stairCount',
  'stairRails',
  'closedRisers',
  'landing',
  'demolition',
  'framingSound',
  'rot',
  'unstable',
  'fascia',
  'pattern',
  'skirting',
  'skirtingCoverage',
  'skirtingDoor',
  'lighting',
  'features',
  'neighbors',
] as const
export type QuestionKey = (typeof QUESTION_KEYS)[number]

export type QuestionKind = 'choice' | 'multi' | 'sections' | 'zip' | 'number' | 'toggle'

export const QUESTION_KIND: Record<QuestionKey, QuestionKind> = {
  projectType: 'choice',
  shape: 'choice',
  sections: 'sections',
  attached: 'choice',
  layout: 'choice',
  height: 'choice',
  slope: 'choice',
  access: 'choice',
  townhouse: 'choice',
  zip: 'zip',
  hoa: 'choice',
  historic: 'choice',
  material: 'choice',
  railingSides: 'choice',
  railingLf: 'number',
  railingStyle: 'choice',
  gates: 'choice',
  privacyWall: 'choice',
  stairType: 'choice',
  stairCount: 'choice',
  stairRails: 'choice',
  closedRisers: 'toggle',
  landing: 'choice',
  demolition: 'choice',
  framingSound: 'choice',
  rot: 'choice',
  unstable: 'choice',
  fascia: 'choice',
  pattern: 'choice',
  skirting: 'choice',
  skirtingCoverage: 'choice',
  skirtingDoor: 'toggle',
  lighting: 'choice',
  features: 'multi',
  neighbors: 'choice',
}

export const hasOptions = (k: QuestionKey) => QUESTION_KIND[k] === 'choice' || QUESTION_KIND[k] === 'multi'

/**
 * Lists whose options are fully described by their price fields and review flag, so the owner may add options to
 * them. Every other option list is locked: relabel, reorder and enable or disable only (the engine branches on
 * those values).
 */
export const DATA_DRIVEN: readonly QuestionKey[] = [
  'material',
  'height',
  'layout',
  'access',
  'railingSides',
  'railingStyle',
  'privacyWall',
  'stairType',
  'demolition',
  'pattern',
  'fascia',
  'skirting',
  'lighting',
  'features',
]

/** Option values the engine branches on inside data-driven lists. They can be repriced, never removed. */
export const REQUIRED_VALUES: Partial<Record<QuestionKey, readonly string[]>> = {
  railingSides: ['none'],
  stairType: ['none'],
  skirting: ['none'],
  lighting: ['none'],
  privacyWall: ['none'],
  demolition: ['none', 'deckingOnly', 'full', 'homeowner'],
}

type FieldBound = 'money' | 'factor' | 'share' | 'percent' | 'feet'

/** The price fields each option of a priced question carries. Questions not listed carry none. */
export const PRICE_FIELDS: Partial<Record<QuestionKey, Record<string, FieldBound>>> = {
  material: { newPerSqft: 'money', redeckPerSqft: 'money' },
  height: { multiplier: 'factor', skirtingHeightFt: 'feet' },
  layout: { multiplier: 'factor' },
  access: { multiplier: 'factor' },
  railingSides: { share: 'share' },
  railingStyle: { perLf: 'money' },
  privacyWall: { lf: 'feet' },
  stairType: { base: 'money', risers: 'feet', railLfPerSide: 'feet' },
  demolition: { price: 'money' },
  fascia: { perLf: 'money' },
  pattern: { pct: 'percent' },
  skirting: { perSqft: 'money' },
  lighting: { price: 'money' },
  features: { price: 'money' },
}

const BOUNDS: Record<FieldBound, [number, number]> = {
  money: [0, 1_000_000],
  factor: [0, 3],
  share: [0, 3],
  percent: [0, 1],
  feet: [0, 1_000],
}

const label = z.string().trim().min(1, 'Enter a label.').max(200, 'Keep it under 200 characters.')
const optionalText = z.string().trim().max(2000, 'Keep it under 2,000 characters.').optional()
const copyText = z.string().trim().min(1, 'Enter some text.').max(2000, 'Keep it under 2,000 characters.')

export const optionSchema = z.object({
  value: z
    .string()
    .regex(/^[a-zA-Z0-9]{1,40}$/, 'Use letters and numbers only.'),
  label,
  hint: optionalText,
  enabled: z.boolean(),
  reviewFlag: z.string().trim().min(1).max(200).optional(),
  price: z.record(z.string(), z.number()),
})
export type EstimatorOption = z.infer<typeof optionSchema>

export const questionSchema = z.object({
  key: z.enum(QUESTION_KEYS),
  label,
  help: optionalText,
  default: z.string().nullable().optional(),
  options: z.array(optionSchema).max(40, 'At most 40 options.').optional(),
})
export type EstimatorQuestion = z.infer<typeof questionSchema>

const money = (max = 1_000_000) => z.number().finite().min(0, 'Must be 0 or more.').max(max, `At most ${max.toLocaleString('en-US')}.`)
const fraction = z.number().finite().min(0, 'Must be 0 or more.').max(1, 'At most 1 (100%).')
const spread = z.tuple([
  z.number().finite().min(0.5, 'Low end at least 50%.').max(0.95, 'Low end at most 95%.'),
  z.number().finite().min(1.05, 'High end at least 105%.').max(2, 'High end at most 200%.'),
])
const zipPrefix = z.string().regex(/^\d{3}$/, 'Use 3-digit ZIP prefixes.')

export const STEP_TITLES_COUNT = 9

export const estimatorDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    questions: z.array(questionSchema),
    prices: z.object({
      minimumProjectPrice: z
        .number()
        .int('Whole dollars only.')
        .min(1000, 'At least $1,000.')
        .max(1_000_000)
        .refine((n) => n % 500 === 0, 'Use a multiple of $500.'),
      markupPercent: fraction,
      permitAllowance: money(),
      gateEach: money(),
      closedRiserPerRiser: money(),
      landingSqft: money(1000),
      landingStructureFactor: z.number().finite().min(0).max(3),
      landingRailLf: money(1000),
      skirtingAccessDoor: money(),
      skirtingPartialShare: fraction,
      privacyWallPerLf: money(),
      stairOpeningLf: money(1000),
      expansionIntegration: fraction,
      redeckFramingContingency: fraction,
    }),
    ranges: z.object({ standard: spread, uncertain: spread, review: spread }),
    serviceArea: z.object({
      primaryZipPrefixes: z.array(zipPrefix).max(200),
      edgeZipPrefixes: z.array(zipPrefix).max(200),
    }),
    copy: z.object({
      steps: z.array(label).length(STEP_TITLES_COUNT),
      intro: copyText,
      serviceArea: z.object({ primary: copyText, edge: copyText, outside: copyText }),
      disclaimers: z.object({
        primary: copyText,
        redeck: copyText,
        permit: copyText,
        material: copyText,
        homeownerDemo: copyText,
        lighting: copyText,
        neighbors: copyText,
        townhouseHoa: copyText,
      }),
      included: z.array(copyText).min(1).max(30),
      priceFactors: z.array(copyText).min(1).max(30),
    }),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>()
    doc.questions.forEach((q, qi) => {
      const at = ['questions', qi]
      if (seen.has(q.key)) ctx.addIssue({ code: 'custom', path: [...at, 'key'], message: `${q.key} appears twice.` })
      seen.add(q.key)
      const fields = PRICE_FIELDS[q.key] ?? {}
      if (!hasOptions(q.key)) {
        if (q.options?.length) ctx.addIssue({ code: 'custom', path: [...at, 'options'], message: 'This question has no options.' })
        if (q.default != null) ctx.addIssue({ code: 'custom', path: [...at, 'default'], message: 'This question has no options to default to.' })
        return
      }
      const opts = q.options ?? []
      const values = new Set<string>()
      opts.forEach((o, oi) => {
        const oat = [...at, 'options', oi]
        if (values.has(o.value)) ctx.addIssue({ code: 'custom', path: [...oat, 'value'], message: `“${o.value}” is used twice.` })
        values.add(o.value)
        for (const [field, bound] of Object.entries(fields)) {
          const v = o.price[field]
          const [min, max] = BOUNDS[bound]
          if (typeof v !== 'number' || !Number.isFinite(v)) {
            ctx.addIssue({ code: 'custom', path: [...oat, 'price', field], message: 'Enter a price.' })
          } else if (v < min || v > max) {
            ctx.addIssue({ code: 'custom', path: [...oat, 'price', field], message: `Must be between ${min} and ${max.toLocaleString('en-US')}.` })
          }
        }
        for (const field of Object.keys(o.price)) {
          if (!(field in fields)) ctx.addIssue({ code: 'custom', path: [...oat, 'price', field], message: `${field} is not a price this question uses.` })
        }
      })
      for (const required of REQUIRED_VALUES[q.key] ?? []) {
        if (!values.has(required)) ctx.addIssue({ code: 'custom', path: [...at, 'options'], message: `The “${required}” option is required.` })
      }
      if (q.key !== 'features' && !opts.some((o) => o.enabled)) {
        ctx.addIssue({ code: 'custom', path: [...at, 'options'], message: 'Turn on at least one option.' })
      }
      if (q.default != null && !opts.some((o) => o.enabled && o.value === q.default)) {
        ctx.addIssue({ code: 'custom', path: [...at, 'default'], message: 'The default must be one of the options that are on.' })
      }
    })
    for (const key of QUESTION_KEYS) {
      if (!seen.has(key)) ctx.addIssue({ code: 'custom', path: ['questions'], message: `The ${key} question is missing.` })
    }
    const { standard, uncertain, review } = doc.ranges
    if (!(review[0] <= uncertain[0] && uncertain[0] <= standard[0] && standard[1] <= uncertain[1] && uncertain[1] <= review[1])) {
      ctx.addIssue({ code: 'custom', path: ['ranges'], message: 'Review must be at least as wide as uncertain, and uncertain at least as wide as standard.' })
    }
  })

export type EstimatorDocument = z.infer<typeof estimatorDocumentSchema>

export const MAX_DOCUMENT_BYTES = 200 * 1024

export type FieldErrors = Record<string, string>

/** Validates a document; on failure, field errors keyed like `questions.12.options.3.price.perLf`. */
export function validateDocument(raw: unknown): { ok: true; doc: EstimatorDocument } | { ok: false; fieldErrors: FieldErrors } {
  if (JSON.stringify(raw ?? null).length > MAX_DOCUMENT_BYTES) return { ok: false, fieldErrors: { '': 'The settings are too large.' } }
  const parsed = estimatorDocumentSchema.safeParse(raw)
  if (parsed.success) return { ok: true, doc: parsed.data }
  const fieldErrors: FieldErrors = {}
  for (const issue of parsed.error.issues) fieldErrors[issue.path.join('.')] ??= issue.message
  return { ok: false, fieldErrors }
}

/**
 * Locked option lists must keep the seed's exact values (checked against the seed document, which defines them).
 * Kept apart from the schema so the schema has no import cycle with the seed.
 */
export function lockedValueErrors(doc: EstimatorDocument, seed: EstimatorDocument): FieldErrors {
  const errors: FieldErrors = {}
  doc.questions.forEach((q, qi) => {
    if (!hasOptions(q.key) || DATA_DRIVEN.includes(q.key)) return
    const want = new Set((seed.questions.find((s) => s.key === q.key)?.options ?? []).map((o) => o.value))
    const got = new Set((q.options ?? []).map((o) => o.value))
    if (want.size !== got.size || [...want].some((v) => !got.has(v))) {
      errors[`questions.${qi}.options`] = 'This question’s options can be renamed, reordered or turned off, but not added or removed.'
    }
  })
  return errors
}

export const question = (doc: EstimatorDocument, key: QuestionKey): EstimatorQuestion => {
  const q = doc.questions.find((x) => x.key === key)
  if (!q) throw new Error(`question ${key} missing from a validated document`)
  return q
}

export const option = (doc: EstimatorDocument, key: QuestionKey, value: string): EstimatorOption => {
  const o = question(doc, key).options?.find((x) => x.value === value)
  if (!o) throw new Error(`option ${key}.${value} missing from a validated document`)
  return o
}
