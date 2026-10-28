// A Homeowner's estimator answers, checked against the Published version they answered (PLAN.md step 2). Unknown,
// disabled or out-of-range values are refused here, so the engine never sees them. Answers to questions that were
// not shown (relevance.ts) are dropped.
import { type EstimatorDocument, QUESTION_KEYS, QUESTION_KIND, type QuestionKey, question } from './document'
import { OPTIONAL, relevantKeys } from './relevance'

export type Section = { width: number; depth: number }

/** Validated answers: only the questions that were shown, each a well-formed value. */
export type Answers = {
  sections: Section[]
  zip: string
  railingLf?: number
  closedRisers: boolean
  skirtingDoor: boolean
  features: string[]
} & Partial<Record<Exclude<QuestionKey, 'sections' | 'zip' | 'railingLf' | 'closedRisers' | 'skirtingDoor' | 'features'>, string>>

export type AnswerErrors = Partial<Record<QuestionKey | '_', string>>

export type ParsedAnswers =
  | { ok: true; answers: Answers; defaulted: QuestionKey[] }
  | { ok: false; errors: AnswerErrors }

const MAX_SECTIONS = 5

/**
 * `raw` is the browser's answers object; `defaultedRaw` lists the questions the Homeowner left on their default.
 * Only shown questions with a default that still equals the answer are kept in `defaulted`.
 */
export function parseAnswers(doc: EstimatorDocument, raw: unknown, defaultedRaw?: unknown): ParsedAnswers {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: { _: 'Missing answers.' } }
  const input = raw as Record<string, unknown>
  const errors: AnswerErrors = {}
  for (const k of Object.keys(input)) {
    if (!(QUESTION_KEYS as readonly string[]).includes(k)) errors._ = `Unknown question ${k.slice(0, 40)}.`
  }

  // Choice answers first: relevance depends only on choice questions. An invalid answer to a question that turns
  // out not to be shown is ignored with the rest of that question.
  const choices: Partial<Record<QuestionKey, string>> = {}
  for (const key of QUESTION_KEYS) {
    if (QUESTION_KIND[key] !== 'choice') continue
    const v = input[key]
    const enabled = (question(doc, key).options ?? []).filter((o) => o.enabled).map((o) => o.value)
    if (typeof v === 'string' && enabled.includes(v)) choices[key] = v
  }
  const relevant = relevantKeys(choices)

  const answers: Record<string, unknown> = { closedRisers: false, skirtingDoor: false, features: [] }
  for (const key of relevant) {
    const v = input[key]
    switch (QUESTION_KIND[key]) {
      case 'choice':
        if (choices[key] !== undefined) answers[key] = choices[key]
        else errors[key] = 'Choose one of the options.'
        break
      case 'multi': {
        const enabled = (question(doc, key).options ?? []).filter((o) => o.enabled).map((o) => o.value)
        if (v === undefined) break
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !enabled.includes(x)) || new Set(v).size !== v.length) {
          errors[key] = 'Choose from the listed options, each once.'
        } else answers[key] = v
        break
      }
      case 'sections':
        if (
          !Array.isArray(v) ||
          v.length < 1 ||
          v.length > MAX_SECTIONS ||
          v.some((s) => !s || typeof s !== 'object' || !inFeet((s as Section).width, 3, 100) || !inFeet((s as Section).depth, 3, 100))
        ) {
          errors[key] = `Enter 1 to ${MAX_SECTIONS} sections, each width and depth 3 to 100 ft.`
        } else answers[key] = v.map((s: Section) => ({ width: s.width, depth: s.depth }))
        break
      case 'zip':
        if (typeof v !== 'string' || !/^\d{5}$/.test(v)) errors[key] = 'Enter a 5-digit ZIP code.'
        else answers[key] = v
        break
      case 'number':
        if (v === undefined || v === null || v === '') break
        if (!inFeet(v, 1, 1000)) errors[key] = 'Enter a length between 1 and 1,000 ft.'
        else answers[key] = v
        break
      case 'toggle':
        if (v === undefined) break
        if (typeof v !== 'boolean') errors[key] = 'Expected yes or no.'
        else answers[key] = v
        break
    }
    if (!OPTIONAL.has(key) && answers[key] === undefined && !errors[key]) errors[key] = 'This question needs an answer.'
  }
  if (Object.keys(errors).length) return { ok: false, errors }

  const defaulted: QuestionKey[] = []
  if (Array.isArray(defaultedRaw)) {
    for (const key of new Set(defaultedRaw)) {
      if (typeof key !== 'string' || !relevant.has(key as QuestionKey)) continue
      const d = question(doc, key as QuestionKey).default
      if (d != null && answers[key] === d) defaulted.push(key as QuestionKey)
    }
  }
  return { ok: true, answers: answers as Answers, defaulted }
}

const inFeet = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
