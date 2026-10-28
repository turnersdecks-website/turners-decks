import type { DispatchState, PipelineStage } from '#/db/schema'

// Client-safe Pipeline and activity vocabulary (GLOSSARY). The CHECK constraints live in src/db/schema.ts.

export const STAGE_LABELS: Record<PipelineStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  appointment: 'Appointment',
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
}
export const STAGES = Object.keys(STAGE_LABELS) as PipelineStage[]

// Kit STATUS_STYLES, mapped onto the CRM's brand tokens (light and dark come from the tokens). Pipeline board chips and
// the Lead page Stage dropdown.
export const STAGE_STYLES: Record<PipelineStage, { chip: string; dot: string }> = {
  new: { chip: 'border-border bg-muted text-foreground', dot: 'bg-muted-foreground' },
  contacted: { chip: 'border-primary/25 bg-primary/10 text-primary', dot: 'bg-primary' },
  appointment: { chip: 'border-warning/40 bg-warning/15 text-warning-foreground dark:text-warning', dot: 'bg-warning' },
  quoted: { chip: 'border-highlight/50 bg-highlight/20 text-highlight-foreground dark:text-highlight', dot: 'bg-highlight' },
  won: { chip: 'border-success/30 bg-success/15 text-success', dot: 'bg-success' },
  lost: { chip: 'border-destructive/30 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
}

// What Staff log by hand. A logged text is one sent from a personal phone; Form submissions are written by Intake.
export const MANUAL_ACTIVITY_KINDS = ['note', 'call', 'email', 'text'] as const
export type ManualActivityKind = (typeof MANUAL_ACTIVITY_KINDS)[number]
export const CALL_DIRECTIONS = ['outbound', 'inbound'] as const
export type CallDirection = (typeof CALL_DIRECTIONS)[number]

export const CALL_OUTCOMES = [
  'Connected',
  'Left voicemail',
  'No answer',
  'Wrong number',
  'Booked appointment',
  'Not interested',
  'Call back later',
]

// Turner's Decks project types (the site's quote form and estimator).
export const SERVICE_TYPES = ['New deck', 'Deck replacement', 'Redeck', 'Deck expansion', 'Pool deck', 'Question', 'Other']

/** How an email the CRM sent reads on a Lead's activity. Never "sent" before Resend accepted it. */
export const DISPATCH_LABELS: Record<DispatchState, string> = {
  queued: 'Queued, not sent yet',
  accepted: 'Sent',
  failed: 'Not sent',
  unknown: "Delivery unknown — an admin can check Resend's log",
}

export const leadName = (l: { firstName: string | null; lastName: string | null }) =>
  [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unnamed Lead'
