import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { companySettings, user } from '#/db/schema'
import { ESTIMATE_EMAIL_PLACEHOLDERS } from '#/lib/estimator/email-template'
import { DATA_DRIVEN, PRICE_FIELDS, type QuestionKey, REQUIRED_VALUES } from '#/lib/estimator/document'
import { SEED_DOCUMENT } from '#/lib/estimator/seed'
import { publishDraft, readDraft, readLatestVersion, saveDraft } from '#/lib/estimator/settings.server'
import { requireAdmin, requireStaff } from '#/lib/guards'
import { badRequest, fieldErrorsResponse, optionalText, record } from '#/lib/input'

// Estimator settings (ADR 0003, FLW-200): any Staff member reads the draft and the live version; only admins save
// or publish. Saves and publishes carry the draft revision they were made from (compare-and-swap).

const STALE = 'Someone else saved the estimator settings since you opened them. Reload to see their changes.'

export const getEstimatorSettings = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async () => {
    const [draft, live] = await Promise.all([readDraft(env.DB), readLatestVersion(env.DB)])
    const publisher = live.publishedBy
      ? await getDb(env.DB).select({ name: user.name }).from(user).where(eq(user.id, live.publishedBy)).get()
      : undefined
    return {
      draft: draft.document,
      revision: draft.revision,
      draftUpdatedAt: draft.updatedAt.getTime(),
      live: { version: live.version, publishedAt: live.publishedAt.getTime(), publishedBy: publisher?.name ?? null },
      // The draft differs from what Homeowners see.
      unpublished: JSON.stringify(draft.document) !== JSON.stringify(live.document),
      rules: {
        dataDriven: DATA_DRIVEN,
        priceFields: PRICE_FIELDS,
        requiredValues: REQUIRED_VALUES,
        // FLW-203: the editor offers Delete only on options the owner added (not in Published version 1). Built here,
        // inside the handler, so the seed's prices never reach the browser bundle.
        seedValues: Object.fromEntries(
          DATA_DRIVEN.map((k) => [k, (SEED_DOCUMENT.questions.find((q) => q.key === k)?.options ?? []).map((o) => o.value)]),
        ) as Partial<Record<QuestionKey, string[]>>,
      },
    }
  })

const revisionOf = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) throw badRequest('Missing revision.')
  return v
}

export const saveEstimatorDraft = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  // Validators run before middleware: never throw here, so an unauthenticated caller always gets 401 first.
  .validator((data: { document: unknown; revision: number }) => record(data))
  .handler(async ({ data, context: { staff } }) => {
    const out = await saveDraft(env.DB, data.document, revisionOf(data.revision), staff.id)
    if (!out.ok && out.reason === 'invalid') throw fieldErrorsResponse(out.fieldErrors)
    if (!out.ok) throw new Response(STALE, { status: 409 })
    return { revision: out.revision }
  })

export const publishEstimatorDraft = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { revision: number }) => record(data))
  .handler(async ({ data, context: { staff } }) => {
    const out = await publishDraft(env.DB, revisionOf(data.revision), staff.id)
    if (!out.ok && out.reason === 'invalid') throw fieldErrorsResponse(out.fieldErrors)
    if (!out.ok) throw new Response(STALE, { status: 409 })
    return { version: out.version }
  })

/** The Estimate email template (company settings); placeholders are listed next to the field. */
export const updateEstimateEmailTemplate = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { template: string }) => record(data))
  .handler(async ({ data }) => {
    const template = optionalText(data.template, 5000)
    if (!template) throw badRequest('The Estimate email needs some text.')
    if (!/\{low\}/.test(template) || !/\{high\}/.test(template)) throw badRequest('Keep {low} and {high} in the email so the Homeowner sees their range.')
    await getDb(env.DB).update(companySettings).set({ estimateEmailTemplate: template }).where(eq(companySettings.id, 1))
    return { template, placeholders: ESTIMATE_EMAIL_PLACEHOLDERS }
  })
