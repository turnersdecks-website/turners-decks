// Which questions the estimator shows, on which step, and when (PLAN.md step 2). Fixed in code for this release:
// the owner edits wording and options, not when a question appears. The public payload carries these rules so the
// site applies them; intake applies the same rules to strip answers the Homeowner was never asked.
import type { QuestionKey } from './document'

/** All conditions must hold. `in`: the answer is one of the values; `notIn`: it is not (an unanswered question is
 * neither in nor out, so the condition fails until it is answered). */
export type Condition = { question: QuestionKey; in?: string[]; notIn?: string[] }
export type StepItem = { key: QuestionKey; showIf?: Condition[] }

const stairs: Condition = { question: 'stairType', notIn: ['none'] }

/** Steps 0–7; step 8 is the contact gate. A rule may only refer to a question on the same or an earlier step. */
export const STEPS: StepItem[][] = [
  [{ key: 'projectType' }],
  [{ key: 'shape' }, { key: 'sections' }, { key: 'attached' }, { key: 'layout' }],
  [{ key: 'height' }, { key: 'slope' }, { key: 'access' }, { key: 'townhouse' }, { key: 'zip' }, { key: 'hoa' }, { key: 'historic' }],
  [{ key: 'material' }],
  [
    { key: 'railingSides' },
    { key: 'railingLf', showIf: [{ question: 'railingSides', notIn: ['none'] }] },
    { key: 'railingStyle', showIf: [{ question: 'railingSides', notIn: ['none'] }] },
    { key: 'gates' },
    { key: 'privacyWall' },
  ],
  [
    { key: 'stairType' },
    { key: 'stairCount', showIf: [stairs] },
    { key: 'stairRails', showIf: [stairs] },
    // Stair rails are priced at the railing style's $/ft: with no deck railings, the style is asked here instead.
    { key: 'railingStyle', showIf: [{ question: 'railingSides', in: ['none'] }, stairs] },
    { key: 'closedRisers', showIf: [stairs] },
    { key: 'landing', showIf: [stairs] },
  ],
  [
    { key: 'demolition' },
    { key: 'framingSound', showIf: [{ question: 'projectType', in: ['redeck'] }] },
    { key: 'rot', showIf: [{ question: 'projectType', in: ['redeck'] }] },
    { key: 'unstable', showIf: [{ question: 'projectType', in: ['redeck'] }] },
  ],
  [
    { key: 'fascia' },
    { key: 'pattern' },
    { key: 'skirting' },
    { key: 'skirtingCoverage', showIf: [{ question: 'skirting', notIn: ['none'] }] },
    { key: 'skirtingDoor', showIf: [{ question: 'skirting', notIn: ['none'] }] },
    { key: 'lighting' },
    { key: 'features' },
    { key: 'neighbors' },
  ],
]

/** Questions a Homeowner may leave unanswered when shown. */
export const OPTIONAL: ReadonlySet<QuestionKey> = new Set(['railingLf', 'closedRisers', 'skirtingDoor', 'features'])

type Answers = Partial<Record<QuestionKey, unknown>>

export function holds(c: Condition, a: Answers): boolean {
  const v = a[c.question]
  if (typeof v !== 'string') return false
  if (c.in && !c.in.includes(v)) return false
  if (c.notIn && c.notIn.includes(v)) return false
  return true
}

export const shown = (item: StepItem, a: Answers) => (item.showIf ?? []).every((c) => holds(c, a))

/** The questions shown for these answers, in step order, each once. */
export function relevantKeys(a: Answers): Set<QuestionKey> {
  const keys = new Set<QuestionKey>()
  for (const step of STEPS) for (const item of step) if (shown(item, a)) keys.add(item.key)
  return keys
}
