import type { JobStatus } from '#/lib/job-statuses'
import { type ChecklistJob, type ProjectStep, checklistFor, checklistItem, isProjectStep, stepProgress } from '#/lib/project-steps'

// The project board (GLOSSARY Project step): won Jobs by step, each step's checklist, moving a Job between steps.
// Shared by the CRM pages (projects.functions.ts) and the MCP tools.

type D1 = Pick<D1Database, 'prepare' | 'batch'>
const badRequest = (m: string) => new Response(m, { status: 400 })
const jobNotFound = () => new Response('Job not found', { status: 404 })

type JobRow = {
  id: string
  name: string
  status: JobStatus
  step: string
  township: string | null
  city: string | null
  start_date: string | null
  finish_date: string | null
  permit_needed: number
  hoa_needed: number
  permit_pulled: number
  hoa_approved: number
  review_asked: number
  review_received: number
  on_website: number
  customer_id: string
  first_name: string | null
  last_name: string | null
  after_photos: number
}

const JOB_SELECT = `SELECT j.id, j.name, j.status, j.step, j.township, j.city, j.start_date, j.finish_date, j.permit_needed, j.hoa_needed,
  j.permit_pulled, j.hoa_approved, j.review_asked, j.review_received, j.on_website, j.customer_id, c.first_name, c.last_name,
  (SELECT count(*) FROM photos p WHERE p.job_id = j.id AND p.stage = 'after' AND p.hidden = 0) AS after_photos
  FROM jobs j JOIN customers c ON c.id = j.customer_id`

const facts = (r: JobRow): ChecklistJob => ({
  permitNeeded: r.permit_needed === 1,
  hoaNeeded: r.hoa_needed === 1,
  township: r.township,
  startDate: r.start_date,
  permitPulled: r.permit_pulled === 1,
  hoaApproved: r.hoa_approved === 1,
  reviewAsked: r.review_asked === 1,
  reviewReceived: r.review_received === 1,
  onWebsite: r.on_website === 1,
  afterPhotoCount: r.after_photos,
})

const stepOf = (r: JobRow): ProjectStep => (isProjectStep(r.step) ? r.step : 'deposit')

async function tickedByJob(d1: D1, jobIds: string[]) {
  const out = new Map<string, Set<string>>()
  for (let i = 0; i < jobIds.length; i += 90) {
    const ids = jobIds.slice(i, i + 90)
    const rows = await d1
      .prepare(`SELECT job_id, item_key FROM job_checklist WHERE job_id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<{ job_id: string; item_key: string }>()
    for (const r of rows.results) {
      if (!out.has(r.job_id)) out.set(r.job_id, new Set())
      out.get(r.job_id)!.add(r.item_key)
    }
  }
  return out
}

/** Done Jobs stay on the board this long after they finish, then drop off (they are still on the Jobs list). */
const DONE_SHOWN_DAYS = 60

/** Every Job on the board: not cancelled, and done ones only for a while after they finish. */
export async function projectBoard(d1: D1, now = Date.now()) {
  const since = new Date(now - DONE_SHOWN_DAYS * 86_400_000).toISOString().slice(0, 10)
  const rows = await d1
    .prepare(`${JOB_SELECT} WHERE j.status != 'cancelled' AND (j.step != 'done' OR coalesce(j.finish_date, '9999') >= ?) ORDER BY coalesce(j.start_date, '9999'), j.created_at`)
    .bind(since)
    .all<JobRow>()
  const ticked = await tickedByJob(d1, rows.results.map((r) => r.id))
  return rows.results.map((r) => {
    const step = stepOf(r)
    const items = checklistFor(facts(r), ticked.get(r.id) ?? new Set())
    return {
      id: r.id,
      name: r.name,
      customerName: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Customer',
      customerId: r.customer_id,
      town: r.township ?? r.city,
      step,
      status: r.status,
      startDate: r.start_date,
      permitNeeded: r.permit_needed === 1,
      hoaNeeded: r.hoa_needed === 1,
      progress: stepProgress(items, step),
    }
  })
}

/** One Job's step and its whole checklist (every step, in order). */
export async function jobChecklist(d1: D1, jobId: string) {
  const r = await d1.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(jobId).first<JobRow>()
  if (!r) throw jobNotFound()
  const ticked = (await tickedByJob(d1, [jobId])).get(jobId) ?? new Set()
  return { jobId, step: stepOf(r), items: checklistFor(facts(r), ticked) }
}

/** The Job status that goes with a step, so the Jobs list and the board agree. */
export function statusForStep(step: ProjectStep, startDate: string | null): JobStatus {
  if (step === 'done') return 'done'
  if (step === 'build' || step === 'closeout') return 'in_progress'
  if (step === 'schedule') return startDate ? 'scheduled' : 'not_scheduled'
  return 'not_scheduled'
}

/** Moves a Job to a step (and its status with it). On hold and cancelled Jobs keep their status until moved to done. */
export async function moveJobToStep(d1: D1, jobId: string, step: unknown, now = Date.now()) {
  if (!isProjectStep(step)) throw badRequest('Unknown project step.')
  const job = await d1.prepare('SELECT status, start_date, finish_date FROM jobs WHERE id = ?').bind(jobId).first<{ status: JobStatus; start_date: string | null; finish_date: string | null }>()
  if (!job) throw jobNotFound()
  const keep = (job.status === 'on_hold' || job.status === 'cancelled') && step !== 'done'
  const status = keep ? job.status : statusForStep(step, job.start_date)
  // Finishing a Job with no finish date gives it today's.
  const finish = step === 'done' && !job.finish_date ? new Date(now).toISOString().slice(0, 10) : job.finish_date
  await d1.prepare('UPDATE jobs SET step = ?, status = ?, finish_date = ?, updated_at = ? WHERE id = ?').bind(step, status, finish, now, jobId).run()
  return { id: jobId, step, status }
}

const FIELD_COLUMNS = { permitPulled: 'permit_pulled', hoaApproved: 'hoa_approved', reviewAsked: 'review_asked', reviewReceived: 'review_received', onWebsite: 'on_website' } as const

/** Ticks or unticks one checklist item. Automatic items cannot be ticked by hand (400). */
export async function setChecklistItem(d1: D1, jobId: string, key: unknown, done: unknown, staffId: string | null, now = Date.now()) {
  const item = typeof key === 'string' ? checklistItem(key) : undefined
  if (!item) throw badRequest('Unknown checklist item.')
  if (typeof done !== 'boolean') throw badRequest('done must be true or false.')
  if (item.auto) throw badRequest(`"${item.label}" ticks itself: ${item.autoHint ?? 'it comes from the Job'}.`)
  const exists = await d1.prepare('SELECT 1 FROM jobs WHERE id = ?').bind(jobId).first()
  if (!exists) throw jobNotFound()
  if (item.field) {
    await d1.prepare(`UPDATE jobs SET ${FIELD_COLUMNS[item.field]} = ?, updated_at = ? WHERE id = ?`).bind(done ? 1 : 0, now, jobId).run()
  } else if (done) {
    await d1.prepare('INSERT OR IGNORE INTO job_checklist (job_id, item_key, done_at, done_by) VALUES (?, ?, ?, ?)').bind(jobId, item.key, now, staffId).run()
  } else {
    await d1.prepare('DELETE FROM job_checklist WHERE job_id = ? AND item_key = ?').bind(jobId, item.key).run()
  }
  return jobChecklist(d1, jobId)
}
