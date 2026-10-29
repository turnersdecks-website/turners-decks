import { sql } from 'drizzle-orm'
import { JOB_STATUSES } from '#/lib/job-statuses'
import { CLIENT_TYPES } from '#/lib/client-types'
import { PHOTO_STAGES } from '#/lib/photo-vocab'
import { type AnySQLiteColumn, check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Better Auth tables (email + password, admin plugin). Times are epoch ms.
// App tables are Pine & Gable's (its PLAN.md > Data model), cut to v1: Leads, activity, stage history, Quote files,
// Form submissions, the email outbox and company settings. Tables and columns are kept identical to Pine & Gable's
// so its later features (Estimates, Appointments, Calls, Texting, Prospects, mailers) can be ported with their own
// additive migrations. Out-of-scope tables are not created.

export const STAFF_ROLES = ['admin', 'staff'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)
    .$onUpdate(() => new Date())

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // admin plugin
    role: text('role', { enum: STAFF_ROLES }).notNull().default('staff'),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: integer('ban_expires', { mode: 'timestamp_ms' }),
  },
  (t) => [check('user_role_check', sql`${t.role} in ('admin', 'staff')`)],
)

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // admin plugin
    impersonatedBy: text('impersonated_by'),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

// ---------------------------------------------------------------------------
// Intake (PLAN.md > Data model). IDs are crypto.randomUUID() text, times epoch ms.

export const PIPELINE_STAGES = ['new', 'contacted', 'appointment', 'quoted', 'won', 'lost'] as const
export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export const SUBMISSION_STATES = ['received', 'processing', 'processed', 'rejected', 'failed'] as const
export type SubmissionState = (typeof SUBMISSION_STATES)[number]

// A Form submission: one raw, unaltered post. Raw columns never change.
export const formSubmissions = sqliteTable('form_submissions', {
  id: text('id').primaryKey(),
  submissionKey: text('submission_key').notNull().unique(),
  fingerprint: text('fingerprint').notNull(),
  receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
  schemaVersion: integer('schema_version').notNull(),
  source: text('source'),
  rawBody: text('raw_body').notNull(),
  ipHash: text('ip_hash'),
})

// Mutable Intake state for a Form submission.
export const submissionProcessing = sqliteTable(
  'submission_processing',
  {
    submissionId: text('submission_id')
      .primaryKey()
      .references(() => formSubmissions.id, { onDelete: 'cascade' }),
    state: text('state', { enum: SUBMISSION_STATES }).notNull().default('received'),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    resultJson: text('result_json'),
    claimedUntil: integer('claimed_until', { mode: 'timestamp_ms' }),
    error: text('error'),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    check(
      'submission_processing_state_check',
      sql`${t.state} in ('received', 'processing', 'processed', 'rejected', 'failed')`,
    ),
  ],
)

// A Lead. `source`, `first_source`, `first_touch_json`, `created_at` are immutable after insert.
export const leads = sqliteTable(
  'leads',
  {
    id: text('id').primaryKey(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    emailLower: text('email_lower'),
    phone: text('phone'),
    phoneE164: text('phone_e164'),
    street: text('street'),
    city: text('city'),
    state: text('state'),
    zip: text('zip'),
    stage: text('stage', { enum: PIPELINE_STAGES }).notNull().default('new'),
    source: text('source').notNull(),
    firstSource: text('first_source').notNull(),
    serviceType: text('service_type'),
    message: text('message'),
    /** What the Homeowner said they want built with (form "Preferred material"), as given. */
    preferredMaterial: text('preferred_material'),
    /** When they want it done (form "Estimated Timeline"), as given. */
    timeframe: text('timeframe'),
    /** How they found us: one of HOW_FOUND (customer-vocab.ts), or other text. Copied to the Customer when won. */
    howFound: text('how_found'),
    /** Who referred them: a Customer, or just a name (e.g. a friend who is not a Customer). */
    referredById: text('referred_by_id').references((): AnySQLiteColumn => customers.id, { onDelete: 'set null' }),
    referredByName: text('referred_by_name'),
    /** Residential or commercial (CLIENT_TYPES). Copied to the Customer when won. */
    clientType: text('client_type', { enum: CLIENT_TYPES }).notNull().default('residential'),
    assignedTo: text('assigned_to').references(() => user.id, { onDelete: 'set null' }),
    leadScore: integer('lead_score'),
    attributionJson: text('attribution_json'),
    firstTouchJson: text('first_touch_json'),
    needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(false),
    /** addressKey() of the address (plan 006 D3), written on every address write; null = no address. */
    addressKey: text('address_key'),
    /** "Leaking now?" on the Estimate panel (plan 008): a flag for Staff only; estimates still show and send. */
    activeLeak: integer('active_leak', { mode: 'boolean' }).notNull().default(false),
    /** Bumped on every write to the leak flag or Roof complexity counts (plan 008): the fence for stale tabs and Save. */
    roofAnswersVersion: integer('roof_answers_version').notNull().default(0),
    /** The Customer this Lead became (set when it is won) or belongs to (a new Lead from a past Customer). */
    customerId: text('customer_id').references((): AnySQLiteColumn => customers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('leads_address_key_idx').on(t.addressKey),
    index('leads_customer_idx').on(t.customerId),
    index('leads_referred_by_idx').on(t.referredById),
    check(
      'leads_stage_check',
      sql`${t.stage} in ('new', 'contacted', 'appointment', 'quoted', 'won', 'lost')`,
    ),
    uniqueIndex('leads_phone_e164_unique').on(t.phoneE164).where(sql`${t.phoneE164} is not null`),
    uniqueIndex('leads_email_lower_unique').on(t.emailLower).where(sql`${t.emailLower} is not null`),
  ],
)

export const ACTIVITY_KINDS = ['note', 'text', 'call', 'email', 'form', 'appointment'] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export const DISPATCH_STATES = ['queued', 'accepted', 'failed', 'unknown'] as const
export type DispatchState = (typeof DISPATCH_STATES)[number]

// What happened with a Lead (notes, texts, calls, emails, Form submissions) and Follow-ups.
export const leadActivity = sqliteTable(
  'lead_activity',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ACTIVITY_KINDS }).notNull(),
    direction: text('direction'),
    outcome: text('outcome'),
    durationMin: integer('duration_min'),
    body: text('body'),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    followUpAt: integer('follow_up_at', { mode: 'timestamp_ms' }),
    followUpDoneAt: integer('follow_up_done_at', { mode: 'timestamp_ms' }),
    dedupeKey: text('dedupe_key').unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // Emails the CRM sends (Estimate email, plan 005 step 6): where the outbox job stands, and Resend's email id.
    // Null for everything else. Never "sent" before Resend accepted it.
    dispatchState: text('dispatch_state', { enum: DISPATCH_STATES }),
    providerMessageId: text('provider_message_id'),
  },
  (t) => [
    check('lead_activity_kind_check', sql`${t.kind} in ('note', 'text', 'call', 'email', 'form', 'appointment')`),
    index('lead_activity_lead_id_idx').on(t.leadId, t.createdAt),
  ],
)

// Stage history: one row per Pipeline stage change, written in the same D1 batch as the stage write (only when that
// write actually changed the stage). from_stage null = the Lead was created at to_stage. changed_by null = automatic.
export const leadStageChanges = sqliteTable(
  'lead_stage_changes',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    fromStage: text('from_stage', { enum: PIPELINE_STAGES }),
    toStage: text('to_stage', { enum: PIPELINE_STAGES }).notNull(),
    changedAt: integer('changed_at', { mode: 'timestamp_ms' }).notNull(),
    changedBy: text('changed_by').references(() => user.id, { onDelete: 'set null' }),
    reason: text('reason'),
  },
  (t) => [index('lead_stage_changes_lead_idx').on(t.leadId, t.changedAt), index('lead_stage_changes_to_stage_idx').on(t.toStage, t.changedAt)],
)

// Quote files (GLOSSARY, plan 009): files Staff upload on a Lead's Quote tab, one current file per slot (`kind`).
// The bytes live in R2 (LEAD_FILES) at `r2_key` = `leads/<leadId>/<fileId>`; keys are never reused. Replacing or
// removing a file is soft (`removed_at`, the object stays); only Lead delete removes rows (cascade) and objects (the
// `r2-cleanup` cron sweeps the Lead's prefix, r2_prefix_deletes). `replaced_by_id` is the replacing row's id, written
// in the same batch that inserts that row; deliberately not a foreign key (plan 009 decision 13).
export const LEAD_FILE_KINDS = ['hover_report', 'materials_list', 'customer_quote', 'signed_quote', 'contractor_agreement'] as const
export type LeadFileKind = (typeof LEAD_FILE_KINDS)[number]
export const LEAD_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'] as const
export type LeadFileType = (typeof LEAD_FILE_TYPES)[number]
export const LEAD_FILE_REMOVED_REASONS = ['replaced', 'removed'] as const

export const leadFiles = sqliteTable(
  'lead_files',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: LEAD_FILE_KINDS }).notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type', { enum: LEAD_FILE_TYPES }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    r2Key: text('r2_key').notNull().unique(),
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    uploadedAt: integer('uploaded_at', { mode: 'timestamp_ms' }).notNull(),
    removedAt: integer('removed_at', { mode: 'timestamp_ms' }),
    removedBy: text('removed_by').references(() => user.id, { onDelete: 'set null' }),
    removedReason: text('removed_reason', { enum: LEAD_FILE_REMOVED_REASONS }),
    replacedById: text('replaced_by_id'),
  },
  (t) => [
    check(
      'lead_files_kind_check',
      sql`${t.kind} in ('hover_report', 'materials_list', 'customer_quote', 'signed_quote', 'contractor_agreement')`,
    ),
    check('lead_files_file_name_check', sql`length(${t.fileName}) between 1 and 200`),
    check('lead_files_content_type_check', sql`${t.contentType} in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')`),
    check('lead_files_size_check', sql`${t.sizeBytes} between 1 and 26214400`),
    check('lead_files_removed_reason_check', sql`${t.removedReason} is null or ${t.removedReason} in ('replaced', 'removed')`),
    check('lead_files_removed_pair', sql`(${t.removedAt} is null) = (${t.removedReason} is null)`),
    check('lead_files_replaced_by_check', sql`${t.replacedById} is null or ${t.removedReason} = 'replaced'`),
    index('lead_files_lead_kind_idx').on(t.leadId, t.kind, t.uploadedAt),
    uniqueIndex('lead_files_one_current').on(t.leadId, t.kind).where(sql`${t.removedAt} is null`),
  ],
)

// R2 prefixes (`leads/<leadId>/`) of deleted Leads, written only by Lead delete in the same batch as the delete, swept
// three times by the `r2-cleanup` cron (about 5 minutes, 1 hour and 24 hours later), then removed. No FK to leads:
// the row outlives the Lead it came from (plan 009 decision 15).
export const r2PrefixDeletes = sqliteTable('r2_prefix_deletes', {
  prefix: text('prefix').primaryKey(),
  sweepsDone: integer('sweeps_done').notNull().default(0),
  nextSweepAt: integer('next_sweep_at', { mode: 'timestamp_ms' }).notNull(),
})

export const CONSENT_PROGRAMS =['sms_followup', 'sms_alerts'] as const
export const CONSENT_EVENTS = ['grant', 'revoke'] as const
export const CONSENT_SOURCES = ['form', 'text', 'staff'] as const

// Text consent, append-only. `occurred_at` is the original event time (a Form submission's
// received_at), never replay or processing time. Survives Lead merge or deletion.
export const consentEvents = sqliteTable(
  'consent_events',
  {
    id: text('id').primaryKey(),
    phoneE164: text('phone_e164').notNull(),
    program: text('program', { enum: CONSENT_PROGRAMS }).notNull(),
    event: text('event', { enum: CONSENT_EVENTS }).notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    disclosureVersion: text('disclosure_version'),
    source: text('source', { enum: CONSENT_SOURCES }).notNull(),
    sourceRef: text('source_ref'),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    recordedAt: integer('recorded_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    check('consent_events_program_check', sql`${t.program} in ('sms_followup', 'sms_alerts')`),
    check('consent_events_event_check', sql`${t.event} in ('grant', 'revoke')`),
    check('consent_events_source_check', sql`${t.source} in ('form', 'text', 'staff')`),
    index('consent_events_phone_idx').on(t.phoneE164, t.program, t.occurredAt),
  ],
)

export const JOB_STATES = ['pending', 'claimed', 'sent', 'failed', 'dead'] as const
export type JobState = (typeof JOB_STATES)[number]

// Notification outbox (PLAN.md > Architecture; src/lib/outbox.ts). Doubles as the email delivery log.
// `first_attempt_at` starts Resend's 24-hour idempotency window; `provider_message_id` is Resend's email id.
export const notificationJobs = sqliteTable(
  'notification_jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payloadJson: text('payload_json').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    state: text('state', { enum: JOB_STATES }).notNull().default('pending'),
    claimedUntil: integer('claimed_until', { mode: 'timestamp_ms' }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }),
    firstAttemptAt: integer('first_attempt_at', { mode: 'timestamp_ms' }),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    providerMessageId: text('provider_message_id'),
    // Null only for jobs enqueued before this column existed (backfilled from first_attempt_at where known).
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    // "Emails sent" (plan 006 S11): written at enqueue for business kinds from the frozen envelope that dispatch
    // sends; null for authentication kinds and for jobs enqueued before these columns existed.
    recipient: text('recipient'),
    subject: text('subject'),
    // How a finished job ended (JobOutcome type): `dead` state covers both a definite refusal (`failed`) and an
    // ambiguous give-up (`dead`). Null while unfinished, and for jobs finished before this column existed.
    outcome: text('outcome', { enum: ['accepted', 'failed', 'dead'] }),
  },
  (t) => [
    check('notification_jobs_state_check', sql`${t.state} in ('pending', 'claimed', 'sent', 'failed', 'dead')`),
    index('notification_jobs_state_idx').on(t.state, t.nextAttemptAt),
  ],
)

// Cron health (PLAN.md > Observability): when each Cron Trigger schedule last started, one row per cron string.
export const cronRuns = sqliteTable('cron_runs', {
  cron: text('cron').primaryKey(),
  lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }).notNull(),
})

// Backlog alarm dedupe (PLAN.md > Observability: per condition per day): a row = that alarm was logged that UTC day.
export const alarmDays = sqliteTable(
  'alarm_days',
  {
    condition: text('condition').notNull(),
    day: text('day').notNull(),
  },
  (t) => [primaryKey({ columns: [t.condition, t.day] })],
)

// Company settings (PLAN.md > Data model): a single row, `CHECK id=1`, seeded by the migration.
// `owner_alert_emails` is a comma-separated list of the addresses Owner alerts go to.
// `texting_enabled` stays 0 until A2P approval (activation gate G1).
export const companySettings = sqliteTable(
  'company_settings',
  {
    id: integer('id').primaryKey().default(1),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    serviceArea: text('service_area'),
    businessNumber: text('business_number'),
    timezone: text('timezone').notNull(),
    ownerAlertEmails: text('owner_alert_emails'),
    textingEnabled: integer('texting_enabled', { mode: 'boolean' }).notNull().default(false),
    /** The Estimate email (FLW-200): `{placeholder}`s, and a first line "Subject: ..." becomes the subject. */
    estimateEmailTemplate: text('estimate_email_template').notNull().default(''),
  },
  // New columns are validated by the server (settings.functions.ts); a CHECK here would force a table rebuild.
  (t) => [check('company_settings_single_row', sql`${t.id} = 1`)],
)

// Estimator settings (ADR 0003, FLW-200). The draft is the one document the owner edits; `revision` makes saves and
// publishes compare-and-swap so two tabs never overwrite each other or publish content nobody reviewed. Published
// versions are append-only: code never updates or deletes a row. The document JSON is validated by
// src/lib/estimator/document.ts before it is written.
export const estimatorDraft = sqliteTable(
  'estimator_draft',
  {
    id: integer('id').primaryKey().default(1),
    documentJson: text('document_json').notNull(),
    revision: integer('revision').notNull().default(1),
    updatedAt: updatedAt(),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [check('estimator_draft_single_row', sql`${t.id} = 1`)],
)

export const estimatorVersions = sqliteTable('estimator_versions', {
  version: integer('version').primaryKey(),
  documentJson: text('document_json').notNull(),
  /** The draft revision this version was published from (null for the seeded version 1). */
  draftRevision: integer('draft_revision'),
  publishedAt: integer('published_at', { mode: 'timestamp_ms' }).notNull(),
  publishedBy: text('published_by').references(() => user.id, { onDelete: 'set null' }),
})

// Estimate snapshots (GLOSSARY): what one estimator Form submission showed the Homeowner, frozen. Never updated;
// one per Form submission. `questions_json` is the Published version's public questions (labels as shown), so a
// Lead page never needs the old version to explain it.
export const estimateSnapshots = sqliteTable(
  'estimate_snapshots',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    submissionId: text('submission_id')
      .notNull()
      .references(() => formSubmissions.id, { onDelete: 'cascade' }),
    version: integer('version')
      .notNull()
      .references(() => estimatorVersions.version),
    engineRevision: integer('engine_revision').notNull(),
    questionsJson: text('questions_json').notNull(),
    answersJson: text('answers_json').notNull(),
    defaultedJson: text('defaulted_json').notNull(),
    lineItemsJson: text('line_items_json').notNull(),
    flagsJson: text('flags_json').notNull(),
    low: integer('low').notNull(),
    mid: integer('mid').notNull(),
    high: integer('high').notNull(),
    belowMinimum: integer('below_minimum', { mode: 'boolean' }).notNull(),
    sqft: real('sqft').notNull(),
    railingLf: integer('railing_lf').notNull(),
    serviceArea: text('service_area').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('estimate_snapshots_submission').on(t.submissionId), index('estimate_snapshots_lead').on(t.leadId, t.createdAt)],
)

// ---------------------------------------------------------------------------
// Customers and Jobs (GLOSSARY). Carried over from the Turner's Decks Airtable tracker (claude/lead-tracker-spec.md,
// 2026-09-19): a Customer is a Homeowner we have done (or are doing) work for; a Job is one project for a Customer.
// A Lead that is won creates both (src/lib/customers.server.ts wonWrites). Money is whole cents; dates without a time
// (start, finish) are 'YYYY-MM-DD' text so a job day never shifts with a time zone.

export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    emailLower: text('email_lower'),
    phone: text('phone'),
    phoneE164: text('phone_e164'),
    street: text('street'),
    city: text('city'),
    state: text('state'),
    zip: text('zip'),
    /** When they became a Customer (the won date, or what an import says). */
    customerSince: integer('customer_since', { mode: 'timestamp_ms' }),
    /** One of HOW_FOUND (customer-vocab.ts), or other text from an import. */
    howFound: text('how_found'),
    referredById: text('referred_by_id').references((): AnySQLiteColumn => customers.id, { onDelete: 'set null' }),
    /** Who referred them when it is not a Customer (e.g. "Kristin"). */
    referredByName: text('referred_by_name'),
    /** Residential or commercial (CLIENT_TYPES). */
    clientType: text('client_type', { enum: CLIENT_TYPES }).notNull().default('residential'),
    reviewLeft: integer('review_left', { mode: 'boolean' }).notNull().default(false),
    okToContact: integer('ok_to_contact', { mode: 'boolean' }).notNull().default(true),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Same dedupe keys as Leads: a won Lead joins the Customer with its phone or email.
    uniqueIndex('customers_phone_e164_unique').on(t.phoneE164).where(sql`${t.phoneE164} is not null`),
    uniqueIndex('customers_email_lower_unique').on(t.emailLower).where(sql`${t.emailLower} is not null`),
    index('customers_referred_by_idx').on(t.referredById),
  ],
)

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    city: text('city'),
    projectType: text('project_type'),
    material: text('material'),
    /** The scope of work, usually from the accepted estimate. */
    scope: text('scope'),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('not_scheduled'),
    startDate: text('start_date'),
    finishDate: text('finish_date'),
    squareFootage: real('square_footage'),
    quotedPriceCents: integer('quoted_price_cents'),
    quotedMaterialCostCents: integer('quoted_material_cost_cents'),
    actualMaterialCostCents: integer('actual_material_cost_cents'),
    laborCostCents: integer('labor_cost_cents'),
    actualLaborHours: real('actual_labor_hours'),
    permitNeeded: integer('permit_needed', { mode: 'boolean' }).notNull().default(false),
    permitPulled: integer('permit_pulled', { mode: 'boolean' }).notNull().default(false),
    hoaNeeded: integer('hoa_needed', { mode: 'boolean' }).notNull().default(false),
    hoaApproved: integer('hoa_approved', { mode: 'boolean' }).notNull().default(false),
    okToShowPhotos: integer('ok_to_show_photos', { mode: 'boolean' }).notNull().default(false),
    onWebsite: integer('on_website', { mode: 'boolean' }).notNull().default(false),
    reviewAsked: integer('review_asked', { mode: 'boolean' }).notNull().default(false),
    reviewReceived: integer('review_received', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('jobs_status_check', sql`${t.status} in ('not_scheduled', 'scheduled', 'in_progress', 'done', 'on_hold', 'cancelled')`),
    index('jobs_customer_idx').on(t.customerId, t.createdAt),
    index('jobs_lead_idx').on(t.leadId),
    index('jobs_status_idx').on(t.status),
  ],
)

// Photos (GLOSSARY Photo). The bytes live in R2 (LEAD_FILES bucket) at `photos/<id>.jpg` and `photos/<id>_t.jpg`
// (thumbnail), always JPEG with location and other metadata stripped (photos.server.ts). A photo belongs to a Job, or
// to a Lead before its Job exists; winning the Lead gives its photos the new Job. Photos are hidden, never deleted.
export const photos = sqliteTable(
  'photos',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    stage: text('stage', { enum: PHOTO_STAGES }).notNull(),
    r2Key: text('r2_key').notNull().unique(),
    thumbR2Key: text('thumb_r2_key'),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** When the phone says it was taken (from the photo before its metadata was removed); null when unknown. */
    takenAt: integer('taken_at', { mode: 'timestamp_ms' }),
    uploadedAt: integer('uploaded_at', { mode: 'timestamp_ms' }).notNull(),
    /** The Photo link it came through, or the Staff member who added it in the CRM. */
    photoLinkId: text('photo_link_id').references((): AnySQLiteColumn => photoLinks.id, { onDelete: 'set null' }),
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    caption: text('caption'),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('photos_job_idx').on(t.jobId, t.uploadedAt), index('photos_lead_idx').on(t.leadId, t.uploadedAt)],
)

// Photo links (GLOSSARY Photo link): an upload-only link for one Lead or Job and one stage, sent to Pat by text. Only
// the SHA-256 of the token is stored. Works until `expires_at` unless `revoked_at` is set.
export const photoLinks = sqliteTable(
  'photo_links',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    /** When Pat tapped "I'm done" (the link still works for more photos until it expires). */
    doneAt: integer('done_at', { mode: 'timestamp_ms' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('photo_links_lead_idx').on(t.leadId), index('photo_links_job_idx').on(t.jobId)],
)

// Photo home screens: a long-lived link saved on one phone (Pat's) that lists every open Photo link. Only the token's
// SHA-256 is stored; turned off with `revoked_at`.
export const photoDevices = sqliteTable('photo_devices', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  name: text('name').notNull(),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
})
