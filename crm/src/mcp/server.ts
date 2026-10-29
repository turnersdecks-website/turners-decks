import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '#/db/client'
import { PIPELINE_STAGES, estimateSnapshots, formSubmissions, leadFiles, submissionProcessing, user } from '#/db/schema'
import { CLIENT_TYPES } from '#/lib/client-types'
import { HOW_FOUND, jobMetrics } from '#/lib/customer-vocab'
import {
  createCustomer,
  createJob,
  customerChanges,
  getCustomer,
  jobChanges,
  getJob,
  listCustomers,
  listJobs,
  updateCustomer,
  updateJob,
} from '#/lib/customers.server'
import { readDraft, readLatestVersion, saveDraft } from '#/lib/estimator/settings.server'
import { JOB_STATUSES } from '#/lib/job-statuses'
import { LINK_STAGES } from '#/lib/photo-vocab'
import { createPhotoLinkRecord, listPhotoRecords } from '#/lib/photos.server'
import {
  LEAD_EDIT_KEYS,
  addActivity,
  assignLeadTo,
  createLeadRecord,
  getLeadDetail,
  importedAt,
  listOpenFollowUps,
  moveLeadToStage,
  searchLeads,
  setFollowUpDoneRecord,
  updateLeadRecord,
} from '#/lib/leads.server'
import { readCompanySettings, saveCompanySettings } from '#/lib/settings.server'
import type { McpProps } from '#/mcp/oauth'

// The CRM's MCP tools (GLOSSARY words throughout). Each call runs as the Staff member who connected (McpProps),
// re-read here so a banned Staff member is refused at once, with the same rules as the CRM pages: the same helpers
// (leads.server.ts, customers.server.ts, settings.server.ts), and admin-only tools refuse staff. Nothing deletes, and
// the estimator draft can be edited but never published (that stays a button in the CRM, since it changes live prices).
// Stateless Streamable HTTP: a fresh server per request, JSON responses.

type Staff = { id: string; name: string; role: 'admin' | 'staff' }

export async function handleMcp(request: Request, env: Env, props: McpProps | undefined): Promise<Response> {
  const staffId = props?.staffId
  const staff = staffId
    ? await getDb(env.DB).select({ id: user.id, name: user.name, role: user.role, banned: user.banned }).from(user).where(eq(user.id, staffId)).get()
    : undefined
  if (!staff || staff.banned) return new Response('This CRM login is no longer active.', { status: 403 })
  const server = buildServer(env, { id: staff.id, name: staff.name, role: staff.role })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(request)
}

// ---------------------------------------------------------------------------
// Results

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

/** Dates as ISO strings; everything else as is. */
const json = (value: unknown) => JSON.stringify(value, (_k, v: unknown) => (v instanceof Date ? v.toISOString() : v), 1)

const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: json(value) }] })

/** Runs a tool body; a thrown Response (the helpers' 400/403/404/409) becomes a tool error the model can read. */
async function run(body: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await body())
  } catch (error) {
    if (error instanceof Response) return { content: [{ type: 'text', text: `Error ${error.status}: ${await error.text()}` }], isError: true }
    throw error
  }
}

const forbidden = () => new Response('Only an admin can do this.', { status: 403 })

const cents = (c: number | null) => (c === null ? null : c / 100)

/** A Job with money in dollars and the tracker's numbers. */
function jobView(j: Awaited<ReturnType<typeof getJob>>['job']) {
  const m = jobMetrics(j)
  const { quotedPriceCents, quotedMaterialCostCents, actualMaterialCostCents, laborCostCents, ...rest } = j
  return {
    ...rest,
    quotedPrice: cents(quotedPriceCents),
    quotedMaterialCost: cents(quotedMaterialCostCents),
    actualMaterialCost: cents(actualMaterialCostCents),
    laborCost: cents(laborCostCents),
    laborHoursPer100Sqft: m.laborHoursPer100Sqft,
    materialVariance: cents(m.materialVarianceCents),
    grossMargin: cents(m.grossMarginCents),
    grossMarginPct: m.grossMarginPct,
  }
}

/** A Lead without the roofing-only columns kept from Good Cover (activeLeak, roofAnswersVersion) or internal keys. */
function leadView(l: Awaited<ReturnType<typeof getLeadDetail>>['lead']) {
  const { activeLeak: _a, roofAnswersVersion: _r, addressKey: _k, emailLower: _e, attributionJson, firstTouchJson, ...rest } = l
  const parse = (s: string | null) => {
    try {
      return s ? (JSON.parse(s) as unknown) : null
    } catch {
      return s
    }
  }
  return { ...rest, attribution: parse(attributionJson), firstTouch: parse(firstTouchJson) }
}

// ---------------------------------------------------------------------------
// Input schemas

const id = z.string().min(1).max(100)
const stage = z.enum(PIPELINE_STAGES)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date like 2027-04-15')
const dateTime = z.string().describe('ISO 8601 date and time, e.g. 2027-04-15T14:00:00-04:00')
const money = z.union([z.number(), z.string()]).nullable().describe('Dollars, e.g. 28500 or "$28,500.50"; null clears it')

const HOW_FOUND_HINT = `${HOW_FOUND.slice(0, -1).join(', ')} or ${HOW_FOUND.at(-1)}`

const leadFieldsShape = {
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  street: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zip: z.string().max(20).optional(),
  serviceType: z.string().max(100).optional().describe('New deck, Deck replacement, Redeck, Deck expansion, Pool deck, Question or Other'),
  message: z.string().max(4000).optional().describe('What the Homeowner asked for, in their words (e.g. the website form\'s "Tell us about your project")'),
  preferredMaterial: z.string().max(100).optional().describe('As the Homeowner said it, e.g. "Composite or Vinyl"'),
  timeframe: z.string().max(100).optional().describe('As the Homeowner said it, e.g. "Ready to start soon"'),
  howFound: z.string().max(100).nullable().optional().describe(`How they found us: ${HOW_FOUND_HINT}`),
  referredById: id.nullable().optional().describe('The Customer id of whoever referred them (see list_customers)'),
  referredByName: z.string().max(200).nullable().optional().describe('Who referred them when that person is not a Customer, e.g. "Kristin"'),
  clientType: z.enum(CLIENT_TYPES).optional().describe('residential (default) or commercial'),
}

/** Import dates: admins only (history brought in from email and the project folders). */
const importAt = (what: string) => dateTime.optional().describe(`Admins importing history only: when ${what} actually happened. Leave out for anything happening now.`)

const customerFieldsShape = {
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().max(200).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  street: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional().describe('Town'),
  state: z.string().max(50).nullable().optional(),
  zip: z.string().max(20).nullable().optional(),
  howFound: z
    .string()
    .max(100)
    .nullable()
    .optional()
    .describe(`How they found us: ${HOW_FOUND_HINT}`),
  customerSince: isoDate.nullable().optional().describe('When they became a Customer; defaults to today for a new one'),
  referredById: id.nullable().optional().describe('The Customer id of whoever referred them'),
  referredByName: z.string().max(200).nullable().optional().describe('Who referred them when that person is not a Customer, e.g. "Kristin"'),
  clientType: z.enum(CLIENT_TYPES).optional().describe('residential (default) or commercial'),
  reviewLeft: z.boolean().optional(),
  okToContact: z.boolean().optional().describe('OK to contact again (defaults to true)'),
  notes: z.string().max(8000).nullable().optional(),
}

const jobFieldsShape = {
  name: z.string().max(200).optional().describe('Street and project type, e.g. "235 Sunrise Road - New deck"'),
  city: z.string().max(100).nullable().optional().describe('Town (defaults to the Customer’s)'),
  projectType: z.string().max(100).nullable().optional().describe('New deck, Deck replacement, Redeck, Deck expansion, Pool deck, Repair, Railing only, Stairs, Pergola or roof, Other'),
  material: z.string().max(100).nullable().optional().describe('Composite, Pressure-treated wood, PVC, Cedar, Specialty wood, Not sure yet'),
  scope: z.string().max(8000).nullable().optional().describe('The scope of work, usually from the accepted estimate'),
  status: z.enum(JOB_STATUSES).optional(),
  startDate: isoDate.nullable().optional(),
  finishDate: isoDate.nullable().optional(),
  squareFootage: z.union([z.number(), z.string()]).nullable().optional(),
  actualLaborHours: z.union([z.number(), z.string()]).nullable().optional(),
  quotedPrice: money.optional(),
  quotedMaterialCost: money.optional(),
  actualMaterialCost: money.optional(),
  laborCost: money.optional(),
  permitNeeded: z.boolean().optional(),
  permitPulled: z.boolean().optional(),
  hoaNeeded: z.boolean().optional(),
  hoaApproved: z.boolean().optional(),
  okToShowPhotos: z.boolean().optional(),
  onWebsite: z.boolean().optional(),
  reviewAsked: z.boolean().optional(),
  reviewReceived: z.boolean().optional(),
  notes: z.string().max(8000).nullable().optional(),
}

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const

const toMs = (value: string | null | undefined, label: string) => {
  if (value === null || value === undefined || value === '') return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) throw new Response(`${label} is not a date and time.`, { status: 400 })
  return ms
}

// ---------------------------------------------------------------------------
// Tools

function buildServer(env: Env, staff: Staff) {
  const db = getDb(env.DB)
  const server = new McpServer(
    { name: 'turners-decks-crm', version: '1.0.0' },
    {
      instructions:
        "Turner's Decks CRM. A Lead is a Homeowner's inquiry, moved through stages new, contacted, appointment, quoted, won, lost. " +
        'Moving a Lead to won makes it a Customer (or joins the Customer with the same phone, else email) and adds a Job. ' +
        'A Customer is someone we have done or are doing work for; a Job is one project with its dates and costs. ' +
        'Money in tool inputs and outputs is in dollars. Nothing can be deleted through these tools.',
    },
  )

  // Leads ------------------------------------------------------------------

  server.registerTool(
    'search_leads',
    {
      title: 'Search Leads',
      description: 'Leads, newest first. Filter by stage and/or search by name, phone, email or town.',
      inputSchema: { stages: z.array(stage).optional(), search: z.string().max(100).optional(), limit: z.number().int().min(1).max(500).optional() },
      annotations: READ,
    },
    (a) => run(() => searchLeads(db, { stages: a.stages, search: a.search, limit: a.limit })),
  )

  server.registerTool(
    'get_lead',
    {
      title: 'Get a Lead',
      description: 'One Lead with its activity (notes, calls, emails, texts, form submissions, Follow-ups), stage history, Customer, current Quote files and Estimate snapshots.',
      inputSchema: { leadId: id },
      annotations: READ,
    },
    (a) =>
      run(async () => {
        const detail = await getLeadDetail(db, a.leadId)
        const [files, snapshots] = await Promise.all([
          db
            .select({ id: leadFiles.id, kind: leadFiles.kind, fileName: leadFiles.fileName, contentType: leadFiles.contentType, sizeBytes: leadFiles.sizeBytes, uploadedAt: leadFiles.uploadedAt })
            .from(leadFiles)
            .where(and(eq(leadFiles.leadId, a.leadId), isNull(leadFiles.removedAt))),
          db.select().from(estimateSnapshots).where(eq(estimateSnapshots.leadId, a.leadId)).orderBy(desc(estimateSnapshots.createdAt)),
        ])
        return {
          ...detail,
          lead: leadView(detail.lead),
          quoteFiles: files,
          estimateSnapshots: snapshots.map((s) => ({
            createdAt: s.createdAt,
            publishedVersion: s.version,
            low: s.low,
            mid: s.mid,
            high: s.high,
            belowMinimum: s.belowMinimum,
            sqft: s.sqft,
            railingLf: s.railingLf,
            serviceArea: s.serviceArea,
            answers: JSON.parse(s.answersJson) as unknown,
            flags: JSON.parse(s.flagsJson) as unknown,
            lineItems: JSON.parse(s.lineItemsJson) as unknown,
          })),
        }
      }),
  )

  server.registerTool(
    'create_lead',
    {
      title: 'Add a Lead',
      description:
        'Adds a Lead by hand (stage new, source manual). Needs a first name. Refused if another Lead has the same phone or email. ' +
        'When importing past inquiries, an admin sets receivedAt and source (website for a past website form).',
      inputSchema: {
        ...leadFieldsShape,
        firstName: z.string().min(1).max(100),
        receivedAt: importAt('the inquiry came in'),
        source: z.enum(['website', 'manual', 'phone', 'referral', 'email']).optional().describe('Admins importing only. Defaults to manual.'),
      },
      annotations: WRITE,
    },
    (a) =>
      run(() => {
        const { receivedAt, source, ...fields } = a
        if ((receivedAt || source) && staff.role !== 'admin') throw forbidden()
        return createLeadRecord(db, fields, staff.id, { receivedAt: importedAt(toMs(receivedAt, 'receivedAt'), 'receivedAt'), source })
      }),
  )

  server.registerTool(
    'update_lead',
    {
      title: 'Edit a Lead',
      description: 'Changes the named fields on a Lead (contact, project, how they found us, referred by, residential or commercial); fields left out keep their value; null clears a referral field. Stage, assignment and notes have their own tools.',
      inputSchema: { leadId: id, ...leadFieldsShape },
      annotations: WRITE,
    },
    (a) =>
      run(async () => {
        const { lead } = await getLeadDetail(db, a.leadId)
        const merged: Record<string, unknown> = {}
        for (const k of LEAD_EDIT_KEYS) merged[k] = a[k] !== undefined ? a[k] : lead[k]
        return updateLeadRecord(db, a.leadId, merged)
      }),
  )

  server.registerTool(
    'move_lead_stage',
    {
      title: 'Move a Lead to a stage',
      description: 'Moves a Lead to new, contacted, appointment, quoted, won or lost. Won also makes or joins the Customer and adds a Job.',
      inputSchema: { leadId: id, stage, at: importAt('the move'), reason: z.string().max(200).optional().describe('Why, e.g. "Went with a cheaper estimate" for lost') },
      annotations: WRITE,
    },
    (a) =>
      run(() => {
        if (a.at && staff.role !== 'admin') throw forbidden()
        return moveLeadToStage(env.DB, a.leadId, a.stage, staff.id, { at: importedAt(toMs(a.at, 'at'), 'at'), reason: a.reason })
      }),
  )

  server.registerTool(
    'assign_lead',
    {
      title: 'Assign a Lead',
      description: 'Assigns a Lead to a Staff member (see list_staff), or unassigns it with staffId null.',
      inputSchema: { leadId: id, staffId: id.nullable() },
      annotations: WRITE,
    },
    (a) => run(() => assignLeadTo(db, a.leadId, a.staffId)),
  )

  server.registerTool(
    'add_lead_activity',
    {
      title: 'Log a note, call, email or text',
      description:
        'Adds a note, or logs a call / email / text, on a Lead, optionally with a Follow-up date. Logging a call, email or text moves a new Lead to contacted; a note does not.',
      inputSchema: {
        leadId: id,
        kind: z.enum(['note', 'call', 'email', 'text']),
        body: z.string().max(8000).optional(),
        direction: z.enum(['outbound', 'inbound']).optional().describe('Calls only'),
        outcome: z.string().max(100).optional().describe('Calls only, e.g. Connected, Left voicemail, No answer, Booked appointment'),
        durationMin: z.number().int().min(0).max(1440).optional().describe('Calls only'),
        followUpAt: dateTime.optional().describe('When to follow up'),
        at: importAt('this note, call, email or text'),
      },
      annotations: WRITE,
    },
    (a) =>
      run(() => {
        const { at, ...rest } = a
        if (at && staff.role !== 'admin') throw forbidden()
        return addActivity(db, { ...rest, followUpAt: toMs(rest.followUpAt, 'Follow-up') }, staff.id, { at: importedAt(toMs(at, 'at'), 'at') })
      }),
  )

  server.registerTool(
    'list_follow_ups',
    {
      title: 'Open Follow-ups',
      description: 'Follow-ups not done yet, soonest first. dueBefore limits to those due by then (e.g. end of today).',
      inputSchema: { dueBefore: dateTime.optional(), limit: z.number().int().min(1).max(500).optional() },
      annotations: READ,
    },
    (a) => run(() => listOpenFollowUps(db, { dueBefore: toMs(a.dueBefore, 'dueBefore'), limit: a.limit })),
  )

  server.registerTool(
    'set_follow_up_done',
    {
      title: 'Mark a Follow-up done',
      description: 'Marks a Follow-up (the activity id from get_lead or list_follow_ups) done, or reopens it with done false.',
      inputSchema: { activityId: id, done: z.boolean() },
      annotations: WRITE,
    },
    (a) => run(() => setFollowUpDoneRecord(db, a.activityId, a.done)),
  )

  // Customers ---------------------------------------------------------------

  server.registerTool(
    'list_customers',
    {
      title: 'List Customers',
      description: 'Customers, newest first, with Jobs done and last Job finished. Search by name, phone, email or town.',
      inputSchema: { search: z.string().max(100).optional(), limit: z.number().int().min(1).max(2000).optional() },
      annotations: READ,
    },
    (a) => run(() => listCustomers(db, { search: a.search, limit: a.limit })),
  )

  server.registerTool(
    'get_customer',
    {
      title: 'Get a Customer',
      description: 'One Customer with their Jobs, Leads, who referred them and whom they referred.',
      inputSchema: { customerId: id },
      annotations: READ,
    },
    (a) =>
      run(async () => {
        const c = await getCustomer(db, a.customerId)
        return { ...c, jobs: c.jobs.map(jobView) }
      }),
  )

  server.registerTool(
    'create_customer',
    {
      title: 'Add a Customer',
      description: 'Adds a past or current Customer by hand. Needs a first or last name. Refused if another Customer has the same phone or email.',
      inputSchema: customerFieldsShape,
      annotations: WRITE,
    },
    (a) => run(() => createCustomer(db, a)),
  )

  server.registerTool(
    'update_customer',
    {
      title: 'Edit a Customer',
      description: 'Changes the named fields on a Customer; fields left out keep their value; null clears one.',
      inputSchema: { customerId: id, ...customerFieldsShape },
      annotations: WRITE,
    },
    (a) =>
      run(() => {
        const { customerId, ...changes } = a
        return updateCustomer(db, customerId, changes)
      }),
  )

  server.registerTool(
    'import_customers',
    {
      title: 'Import Customers',
      description:
        'Adds up to 100 past Customers at once, each optionally with their past Jobs. A row whose phone or email already belongs to a Customer is skipped (reported, not changed). Returns one result per row.',
      inputSchema: {
        customers: z
          .array(z.object({ ...customerFieldsShape, jobs: z.array(z.object({ ...jobFieldsShape, name: z.string().min(1).max(200) })).max(50).optional() }))
          .min(1)
          .max(100),
      },
      annotations: WRITE,
    },
    (a) =>
      run(async () => {
        const results: { index: number; status: 'created' | 'skipped' | 'error'; customerId?: string; jobIds?: string[]; message?: string }[] = []
        for (const [index, row] of a.customers.entries()) {
          const { jobs: rowJobs = [], ...fields } = row
          try {
            // Validate the row and its Jobs before writing anything for it.
            customerChanges(fields)
            for (const job of rowJobs) jobChanges(job)
            const customer = await createCustomer(db, fields)
            const jobIds: string[] = []
            for (const job of rowJobs) jobIds.push((await createJob(db, { ...job, customerId: customer.id })).id)
            results.push({ index, status: 'created', customerId: customer.id, jobIds })
          } catch (error) {
            if (!(error instanceof Response)) throw error
            results.push({ index, status: error.status === 409 ? 'skipped' : 'error', message: await error.text() })
          }
        }
        const count = (s: string) => results.filter((r) => r.status === s).length
        return { created: count('created'), skipped: count('skipped'), errors: count('error'), results }
      }),
  )

  // Jobs ---------------------------------------------------------------------

  server.registerTool(
    'list_jobs',
    {
      title: 'List Jobs',
      description: 'Jobs, newest first, with money in dollars and the margin numbers. Filter by status and/or Customer.',
      inputSchema: { statuses: z.array(z.enum(JOB_STATUSES)).optional(), customerId: id.optional(), limit: z.number().int().min(1).max(2000).optional() },
      annotations: READ,
    },
    (a) =>
      run(async () =>
        (await listJobs(db, { status: a.statuses, customerId: a.customerId, limit: a.limit })).map((r) => ({
          ...jobView(r.job),
          customerName: [r.customerFirstName, r.customerLastName].filter(Boolean).join(' '),
        })),
      ),
  )

  server.registerTool(
    'create_photo_link',
    {
      title: 'Make a photo link for Pat',
      description:
        'Makes an upload-only link for one Lead or Job and a stage (before, during or after). Returns the link and a ready text message; Kristin sends it to Pat from her phone. The link works for 14 days and can only add photos.',
      inputSchema: { leadId: id.optional(), jobId: id.optional(), stage: z.enum(LINK_STAGES) },
      annotations: WRITE,
    },
    (a) => run(() => createPhotoLinkRecord(env.DB, a, staff.id, env.BETTER_AUTH_URL)),
  )

  server.registerTool(
    'list_photos',
    {
      title: 'List photos',
      description: 'Photos of a Lead, Job or Customer (stage, when taken, star, hidden, caption). Photos open in the CRM, not here.',
      inputSchema: { leadId: id.optional(), jobId: id.optional(), customerId: id.optional() },
      annotations: READ,
    },
    (a) => run(() => listPhotoRecords(env.DB, a)),
  )

  server.registerTool(
    'get_job',
    {
      title: 'Get a Job',
      description: 'One Job with its Customer, money in dollars, and labor hours per 100 sq ft, material variance and gross margin.',
      inputSchema: { jobId: id },
      annotations: READ,
    },
    (a) =>
      run(async () => {
        const { job, customer } = await getJob(db, a.jobId)
        return { job: jobView(job), customer }
      }),
  )

  server.registerTool(
    'create_job',
    {
      title: 'Add a Job',
      description: 'Adds a Job for a Customer, optionally tied to one of their Leads.',
      inputSchema: { customerId: id, leadId: id.optional(), ...jobFieldsShape, name: z.string().min(1).max(200) },
      annotations: WRITE,
    },
    (a) => run(async () => jobView(await createJob(db, a))),
  )

  server.registerTool(
    'update_job',
    {
      title: 'Edit a Job',
      description: 'Changes the named fields on a Job; fields left out keep their value; null clears one. Money in dollars, dates as YYYY-MM-DD.',
      inputSchema: { jobId: id, ...jobFieldsShape },
      annotations: WRITE,
    },
    (a) =>
      run(async () => {
        const { jobId, ...changes } = a
        return jobView(await updateJob(db, jobId, changes))
      }),
  )

  // Team and settings ---------------------------------------------------------

  server.registerTool(
    'list_staff',
    {
      title: 'List Staff',
      description: 'Staff members (ids, names, roles), for assigning Leads. Includes who is connected.',
      inputSchema: {},
      annotations: READ,
    },
    () =>
      run(async () => ({
        you: staff,
        staff: (await db.select({ id: user.id, name: user.name, role: user.role, banned: user.banned }).from(user).orderBy(asc(user.name))).map(
          ({ banned, ...s }) => ({ ...s, active: !banned }),
        ),
      })),
  )

  server.registerTool(
    'get_company_settings',
    { title: 'Company settings', description: 'Company name, phone, email, service area, time zone, Owner alert emails and the Estimate email template.', inputSchema: {}, annotations: READ },
    () => run(() => readCompanySettings(env.DB)),
  )

  server.registerTool(
    'update_company_settings',
    {
      title: 'Edit company settings (admin)',
      description: 'Admins only. Changes the named company settings; fields left out keep their value.',
      inputSchema: {
        name: z.string().max(200).optional(),
        phone: z.string().max(50).nullable().optional(),
        email: z.string().max(200).nullable().optional(),
        serviceArea: z.string().max(500).nullable().optional(),
        businessNumber: z.string().max(50).nullable().optional(),
        timezone: z.string().max(64).optional().describe('IANA time zone, e.g. America/New_York'),
        ownerAlertEmails: z.string().max(2000).nullable().optional().describe('Comma-separated, up to 10'),
      },
      annotations: WRITE,
    },
    (a) =>
      run(async () => {
        if (staff.role !== 'admin') throw forbidden()
        const current = await readCompanySettings(env.DB)
        const merged: Record<string, unknown> = {}
        for (const k of ['name', 'phone', 'email', 'serviceArea', 'businessNumber', 'timezone', 'ownerAlertEmails'] as const) {
          merged[k] = a[k] !== undefined ? a[k] : current[k]
        }
        return saveCompanySettings(env.DB, merged)
      }),
  )

  server.registerTool(
    'get_estimator_settings',
    {
      title: 'Estimator settings',
      description:
        'The online estimator: the live Published version (what Homeowners see) and the draft (with its revision, needed to save it). Prices are in dollars per unit as stored.',
      inputSchema: {},
      annotations: READ,
    },
    () =>
      run(async () => {
        const [draft, live] = await Promise.all([readDraft(env.DB), readLatestVersion(env.DB)])
        return {
          live: { version: live.version, publishedAt: live.publishedAt, document: live.document },
          draft: { revision: draft.revision, updatedAt: draft.updatedAt, document: draft.document },
          draftDiffersFromLive: JSON.stringify(draft.document) !== JSON.stringify(live.document),
        }
      }),
  )

  server.registerTool(
    'update_estimator_draft',
    {
      title: 'Save the estimator draft (admin)',
      description:
        'Admins only. Saves a whole new draft document (from get_estimator_settings, changed) with the revision it was read at. Does NOT publish: an admin reviews and publishes in the CRM under Estimator settings.',
      inputSchema: { document: z.record(z.string(), z.unknown()), revision: z.number().int().min(1) },
      annotations: WRITE,
    },
    (a) =>
      run(async () => {
        if (staff.role !== 'admin') throw forbidden()
        const out = await saveDraft(env.DB, a.document, a.revision, staff.id)
        if (!out.ok && out.reason === 'invalid') throw new Response(`Some fields need fixing: ${JSON.stringify(out.fieldErrors)}`, { status: 400 })
        if (!out.ok) throw new Response('Someone saved the estimator settings since you read them. Read them again.', { status: 409 })
        return { revision: out.revision, note: 'Saved as a draft. Publish it in the CRM under Estimator settings to change the live estimator.' }
      }),
  )

  server.registerTool(
    'list_form_submissions',
    {
      title: 'Form submissions (admin)',
      description: 'Admins only. Raw website Form submissions with their Intake state, newest first; optionally only those for one Lead.',
      inputSchema: { leadId: id.optional(), limit: z.number().int().min(1).max(200).optional() },
      annotations: READ,
    },
    (a) =>
      run(async () => {
        if (staff.role !== 'admin') throw forbidden()
        const rows = await db
          .select({
            id: formSubmissions.id,
            receivedAt: formSubmissions.receivedAt,
            source: formSubmissions.source,
            rawBody: formSubmissions.rawBody,
            state: submissionProcessing.state,
            error: submissionProcessing.error,
            leadId: submissionProcessing.leadId,
          })
          .from(formSubmissions)
          .innerJoin(submissionProcessing, eq(submissionProcessing.submissionId, formSubmissions.id))
          .where(a.leadId ? eq(submissionProcessing.leadId, a.leadId) : undefined)
          .orderBy(desc(formSubmissions.receivedAt))
          .limit(a.limit ?? 50)
        return rows.map(({ rawBody, ...r }) => {
          // The Turnstile token is a one-use secret of no use to anyone reading; leave it out.
          let body: unknown = rawBody
          try {
            const { turnstile_token: _t, ...rest } = JSON.parse(rawBody) as Record<string, unknown>
            body = rest
          } catch {
            // keep the raw text
          }
          return { ...r, body }
        })
      }),
  )

  return server
}
