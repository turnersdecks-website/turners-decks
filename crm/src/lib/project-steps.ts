// The project board (GLOSSARY Project step): where a won Job is between the deposit and close-out, and the checklist
// for each step. Client-safe and hardcoded for now (Kristin's first list, 2026-10-29); it can move to Settings later.
//
// A checklist item is one of three kinds:
// - ticked by hand, stored in job_checklist;
// - backed by a Job column (`field`), so the Job form, the MCP tools and the board agree;
// - automatic (`auto`): the CRM works it out from the Job and cannot be ticked by hand.
// `when` hides an item that does not apply (no permit, no HOA).

export const PROJECT_STEPS = ['deposit', 'permit', 'selections', 'takeoff', 'schedule', 'build', 'closeout', 'done'] as const
export type ProjectStep = (typeof PROJECT_STEPS)[number]

export const PROJECT_STEP_LABELS: Record<ProjectStep, string> = {
  deposit: 'Waiting for deposit',
  permit: 'Permit work',
  selections: 'Customer selections',
  takeoff: 'Material takeoff',
  schedule: 'Schedule with customer',
  build: 'Build',
  closeout: 'Close out',
  done: 'Done',
}

export const isProjectStep = (v: unknown): v is ProjectStep => typeof v === 'string' && (PROJECT_STEPS as readonly string[]).includes(v)

/** The Job facts the checklist reads. */
export type ChecklistJob = {
  permitNeeded: boolean
  hoaNeeded: boolean
  township: string | null
  startDate: string | null
  permitPulled: boolean
  hoaApproved: boolean
  reviewAsked: boolean
  reviewReceived: boolean
  onWebsite: boolean
  afterPhotoCount: number
}

/** Job columns a checklist item may stand for. */
export type ChecklistField = 'permitPulled' | 'hoaApproved' | 'reviewAsked' | 'reviewReceived' | 'onWebsite'

export type ChecklistItemDef = {
  key: string
  label: string
  step: ProjectStep
  when?: (j: ChecklistJob) => boolean
  field?: ChecklistField
  auto?: (j: ChecklistJob) => boolean
  /** Shown under an automatic item: where its tick comes from. */
  autoHint?: string
}

const permit = (j: ChecklistJob) => j.permitNeeded
const hoa = (j: ChecklistJob) => j.hoaNeeded

export const CHECKLIST: ChecklistItemDef[] = [
  { step: 'deposit', key: 'estimate_signed', label: 'Estimate signed' },
  { step: 'deposit', key: 'deposit_received', label: 'Deposit received' },

  { step: 'permit', key: 'township', label: 'Township on the Job', when: permit, auto: (j) => Boolean(j.township), autoHint: 'Set Township on the Job' },
  { step: 'permit', key: 'permit_applied', label: 'Permit application submitted', when: permit },
  { step: 'permit', key: 'permit_fee_paid', label: 'Permit fee paid', when: permit },
  { step: 'permit', key: 'permit_approved', label: 'Permit approved', when: permit, field: 'permitPulled' },
  { step: 'permit', key: 'hoa_submitted', label: 'HOA application submitted', when: hoa },
  { step: 'permit', key: 'hoa_approved', label: 'HOA approved', when: hoa, field: 'hoaApproved' },

  { step: 'selections', key: 'decking_chosen', label: 'Decking product and color chosen' },
  { step: 'selections', key: 'railing_chosen', label: 'Railing style and color chosen' },
  { step: 'selections', key: 'selections_confirmed', label: 'Selections confirmed with the customer in writing' },

  { step: 'takeoff', key: 'takeoff_done', label: 'Material takeoff done' },
  { step: 'takeoff', key: 'materials_ordered', label: 'Materials ordered' },
  { step: 'takeoff', key: 'delivery_set', label: 'Delivery date set' },

  { step: 'schedule', key: 'start_date', label: 'Start date set', auto: (j) => Boolean(j.startDate), autoHint: 'Set Start date on the Job' },
  { step: 'schedule', key: 'customer_confirmed', label: 'Customer confirmed the start date' },

  { step: 'build', key: 'framing_inspection', label: 'Framing inspection passed', when: permit },
  { step: 'build', key: 'build_complete', label: 'Build complete' },
  { step: 'build', key: 'after_photos', label: 'After photos taken', auto: (j) => j.afterPhotoCount > 0, autoHint: 'Ticks when after photos are added' },

  { step: 'closeout', key: 'final_inspection', label: 'Final inspection passed', when: permit },
  { step: 'closeout', key: 'final_invoice', label: 'Final invoice sent' },
  { step: 'closeout', key: 'paid_in_full', label: 'Paid in full' },
  { step: 'closeout', key: 'review_asked', label: 'Review asked', field: 'reviewAsked' },
  { step: 'closeout', key: 'review_received', label: 'Review received', field: 'reviewReceived' },
  { step: 'closeout', key: 'on_website', label: 'On the website', field: 'onWebsite' },
]

export const checklistItem = (key: string) => CHECKLIST.find((i) => i.key === key)

export type ChecklistState = { key: string; label: string; step: ProjectStep; done: boolean; kind: 'manual' | 'field' | 'auto'; autoHint?: string }

/** The items that apply to this Job, with whether each is done. `ticked` holds the hand-ticked keys. */
export function checklistFor(job: ChecklistJob, ticked: ReadonlySet<string>): ChecklistState[] {
  return CHECKLIST.filter((i) => !i.when || i.when(job)).map((i) => {
    if (i.auto) return { key: i.key, label: i.label, step: i.step, done: i.auto(job), kind: 'auto', autoHint: i.autoHint }
    if (i.field) return { key: i.key, label: i.label, step: i.step, done: job[i.field], kind: 'field' }
    return { key: i.key, label: i.label, step: i.step, done: ticked.has(i.key), kind: 'manual' }
  })
}

/** Done and total items of one step (a step with nothing that applies, e.g. Permit work with no permit or HOA, is 0/0). */
export function stepProgress(items: ChecklistState[], step: ProjectStep) {
  const mine = items.filter((i) => i.step === step)
  return { done: mine.filter((i) => i.done).length, total: mine.length }
}
