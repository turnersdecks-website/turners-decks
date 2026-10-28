// What the public estimator may see of a Published version (ADR 0003): questions, enabled options, defaults, step
// layout and copy. Never prices or site-review flags. Also the priced result intake sends back to the browser.
import { type EstimatorDocument, QUESTION_KIND, type QuestionKey, type QuestionKind, lockedValueErrors, validateDocument } from './document'
import type { EstimateResult, ServiceArea } from './engine'
import { type Condition, OPTIONAL, STEPS } from './relevance'
import { SEED_DOCUMENT } from './seed'

export type PublicQuestion = {
  key: QuestionKey
  kind: QuestionKind
  label: string
  help?: string
  default: string | null
  optional: boolean
  options?: { value: string; label: string; hint?: string }[]
}

export type PublicEstimator = {
  version: number
  steps: { title: string; items: { key: QuestionKey; showIf?: Condition[] }[] }[]
  questions: Record<string, PublicQuestion>
  serviceArea: EstimatorDocument['serviceArea']
  copy: EstimatorDocument['copy']
}

export function toPublic(doc: EstimatorDocument, version: number): PublicEstimator {
  const questions: Record<string, PublicQuestion> = {}
  for (const q of doc.questions) {
    questions[q.key] = {
      key: q.key,
      kind: QUESTION_KIND[q.key],
      label: q.label,
      ...(q.help ? { help: q.help } : {}),
      default: q.default ?? null,
      optional: OPTIONAL.has(q.key),
      ...(q.options
        ? { options: q.options.filter((o) => o.enabled).map((o) => ({ value: o.value, label: o.label, ...(o.hint ? { hint: o.hint } : {}) })) }
        : {}),
    }
  }
  return {
    version,
    steps: STEPS.map((items, i) => ({ title: doc.copy.steps[i]!, items })),
    questions,
    serviceArea: doc.serviceArea,
    copy: doc.copy,
  }
}

/** The price shown to the Homeowner. Line items, the midpoint and flag wording stay in the CRM. */
export type PublicResult = {
  version: number
  low: number
  high: number
  belowMinimum: boolean
  needsReview: boolean
  sqft: number
  railingLf: number
  serviceArea: ServiceArea
}

export const toPublicResult = (version: number, r: EstimateResult): PublicResult => ({
  version,
  low: r.low,
  high: r.high,
  belowMinimum: r.belowMinimum,
  needsReview: r.flags.length > 0,
  sqft: r.sqft,
  railingLf: r.railingLf,
  serviceArea: r.serviceArea,
})

/** Full validation for save and publish: the schema, then the locked option lists. */
export function validateSettings(raw: unknown) {
  const v = validateDocument(raw)
  if (!v.ok) return v
  const locked = lockedValueErrors(v.doc, SEED_DOCUMENT)
  return Object.keys(locked).length ? ({ ok: false, fieldErrors: locked } as const) : v
}
