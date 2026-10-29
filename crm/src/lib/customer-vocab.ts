import type { JobStatus } from '#/lib/job-statuses'

// Client-safe Customer and Job vocabulary (GLOSSARY). The CHECK constraint lives in src/db/schema.ts.

export { CLOSED_JOB_STATUSES, JOB_STATUSES, type JobStatus } from '#/lib/job-statuses'

export const HOW_FOUND = ['Google search', 'Google Business Profile', 'Referral', 'Repeat customer', 'Facebook', 'Yard sign', 'Truck', 'Other']

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  not_scheduled: 'Not scheduled',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  done: 'Done',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
}

// Kit status chips on the brand tokens, as STAGE_STYLES (pipeline.ts).
export const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  not_scheduled: 'border-border bg-muted text-foreground',
  scheduled: 'border-primary/25 bg-primary/10 text-primary',
  in_progress: 'border-warning/40 bg-warning/15 text-warning-foreground dark:text-warning',
  done: 'border-success/30 bg-success/15 text-success',
  on_hold: 'border-highlight/50 bg-highlight/20 text-highlight-foreground dark:text-highlight',
  cancelled: 'border-destructive/30 bg-destructive/10 text-destructive',
}

// Airtable tracker options (claude/lead-tracker-spec.md) plus the site's project types (SERVICE_TYPES). Suggestions:
// the column is free text so an import keeps what it had.
export const PROJECT_TYPES = [
  'New deck',
  'Deck replacement',
  'Redeck',
  'Deck expansion',
  'Pool deck',
  'Repair',
  'Railing only',
  'Stairs',
  'Pergola or roof',
  'Other',
]

export const MATERIALS = ['Composite', 'Pressure-treated wood', 'PVC', 'Cedar', 'Specialty wood', 'Not sure yet']

export const customerName = (c: { firstName: string | null; lastName: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed Customer'

/** $1,234 or $1,234.50 from whole cents; '' for null. */
export function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  const dollars = cents / 100
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })
}

/**
 * The Airtable tracker's computed fields (lead-tracker-spec.md > Jobs > Computed), from the stored numbers. Each is null
 * until its inputs are filled in. Labor cost is entered by hand: no labor rate is assumed anywhere.
 */
export function jobMetrics(j: {
  squareFootage: number | null
  actualLaborHours: number | null
  quotedPriceCents: number | null
  quotedMaterialCostCents: number | null
  actualMaterialCostCents: number | null
  laborCostCents: number | null
}) {
  const laborHoursPer100Sqft =
    j.squareFootage && j.squareFootage > 0 && j.actualLaborHours !== null ? Math.round((100 * j.actualLaborHours) / j.squareFootage) : null
  const materialVarianceCents =
    j.actualMaterialCostCents !== null && j.quotedMaterialCostCents !== null ? j.actualMaterialCostCents - j.quotedMaterialCostCents : null
  const grossMarginCents =
    j.quotedPriceCents !== null && j.actualMaterialCostCents !== null && j.laborCostCents !== null
      ? j.quotedPriceCents - j.actualMaterialCostCents - j.laborCostCents
      : null
  const grossMarginPct =
    grossMarginCents !== null && j.quotedPriceCents !== null && j.quotedPriceCents > 0 ? Math.round((100 * grossMarginCents) / j.quotedPriceCents) : null
  return { laborHoursPer100Sqft, materialVarianceCents, grossMarginCents, grossMarginPct }
}
