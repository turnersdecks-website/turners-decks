import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { formSubmissions, submissionProcessing } from '#/db/schema'
import { requireAdmin } from '#/lib/guards'
import { replayFormSubmission } from '#/lib/intake'

export const SUBMISSIONS_PAGE_SIZE = 100

/** `unresolved`: rejected, failed, or stuck (never claimed, or its claim expired); `all`: every Form submission. */
export type SubmissionsView = 'unresolved' | 'all'

/**
 * Form submissions with their Intake state, newest first, one page at a time (admin only). `before` is the
 * previous page's `nextBefore` cursor; a page with more behind it returns one.
 */
export const listSubmissions = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  // Validators run before middleware: never throw here, so an unauthenticated caller always gets 401 first.
  .validator((data: { view?: SubmissionsView; before?: string } | undefined) => {
    const d = (data ?? {}) as { view?: unknown; before?: unknown }
    return {
      view: (d.view === 'all' ? 'all' : 'unresolved') as SubmissionsView,
      before: typeof d.before === 'string' ? parseCursor(d.before) : null,
    }
  })
  .handler(async ({ data }) => {
    const { view, before } = data
    const stuck = and(
      eq(submissionProcessing.state, 'processing'),
      or(isNull(submissionProcessing.claimedUntil), lt(submissionProcessing.claimedUntil, new Date())),
    )
    const unresolved = or(inArray(submissionProcessing.state, ['received', 'rejected', 'failed']), stuck)
    const older = before
      ? or(
          lt(formSubmissions.receivedAt, before.receivedAt),
          and(eq(formSubmissions.receivedAt, before.receivedAt), lt(formSubmissions.id, before.id)),
        )
      : undefined
    const rows = await getDb(env.DB)
      .select({
        id: formSubmissions.id,
        receivedAt: formSubmissions.receivedAt,
        source: formSubmissions.source,
        rawBody: formSubmissions.rawBody,
        state: submissionProcessing.state,
        error: submissionProcessing.error,
        attempts: submissionProcessing.attempts,
        leadId: submissionProcessing.leadId,
      })
      .from(formSubmissions)
      .innerJoin(submissionProcessing, eq(submissionProcessing.submissionId, formSubmissions.id))
      .where(and(view === 'unresolved' ? unresolved : undefined, older))
      .orderBy(desc(formSubmissions.receivedAt), desc(formSubmissions.id))
      .limit(SUBMISSIONS_PAGE_SIZE + 1)
    const page = rows.slice(0, SUBMISSIONS_PAGE_SIZE)
    const last = page.at(-1)
    return {
      rows: page.map(({ rawBody, ...row }) => ({ ...row, ...contactOf(rawBody) })),
      nextBefore: rows.length > SUBMISSIONS_PAGE_SIZE && last ? `${last.receivedAt.getTime()}_${last.id}` : null,
    }
  })

/** `<received_at ms>_<id>` -> keyset position; anything else -> first page. */
function parseCursor(cursor: string): { receivedAt: Date; id: string } | null {
  const m = cursor.match(/^(\d{1,15})_(.{1,100})$/)
  return m ? { receivedAt: new Date(Number(m[1])), id: m[2] } : null
}

/** Admin Replay of one Form submission (idempotent). */
export const replaySubmission = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  // Validators run before middleware: never throw here, so an unauthenticated caller always gets 401 first.
  .validator((data: { submissionId: string }) => {
    const id = (data as { submissionId?: unknown } | null)?.submissionId
    return { submissionId: typeof id === 'string' && id.length <= 100 ? id : '' }
  })
  .handler(async ({ data }) => {
    if (!data.submissionId) throw new Response('Bad Request', { status: 400 })
    const { status, body } = await replayFormSubmission(env.DB, data.submissionId)
    return {
      status,
      success: body.success === true,
      pending: body.pending === true,
      error: typeof body.error === 'string' ? body.error : null,
      leadId: typeof body.lead_id === 'string' ? body.lead_id : null,
    }
  })

/** Name / phone / email as the Homeowner typed them, for the list (the raw body is never changed). */
function contactOf(raw: string): { name: string | null; phone: string | null; email: string | null } {
  try {
    const p = JSON.parse(raw) as Record<string, unknown>
    const s = (k: string) => (typeof p[k] === 'string' && p[k] ? (p[k] as string).slice(0, 200) : null)
    return { name: s('name'), phone: s('phone'), email: s('email') }
  } catch {
    return { name: null, phone: null, email: null }
  }
}
