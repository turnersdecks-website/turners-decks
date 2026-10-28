// Estimator Form submissions (FLW-201, ADR 0003): price the answers against the Published version the Homeowner
// answered, and build what Intake stores and sends for them. Intake (intake.ts) calls these; nothing here writes.
import { eq } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { estimateSnapshots, estimatorVersions } from '#/db/schema'
import type { Email } from '#/lib/email'
import { type AnswerErrors, type Answers, parseAnswers } from '#/lib/estimator/answers'
import type { EstimatorDocument, QuestionKey } from '#/lib/estimator/document'
import { renderTemplate } from '#/lib/estimator/email-template'
import { ENGINE_REVISION, type EstimateResult, estimate, isSaneResult } from '#/lib/estimator/engine'
import { type PublicResult, toPublic, toPublicResult } from '#/lib/estimator/public'
import type { CompanySettings } from '#/lib/settings.server'

type Db = ReturnType<typeof getDb>

export type PricedEstimate = {
  version: number
  doc: EstimatorDocument
  answers: Answers
  defaulted: QuestionKey[]
  result: EstimateResult
  publicResult: PublicResult
}

export type PricingFailure = { error: 'unknown_version' | 'outdated_version' | 'invalid_answers'; errors?: AnswerErrors }

/**
 * How long a superseded Published version is still accepted: a Homeowner who opened the estimator just before the
 * owner published can finish on the version they answered. Older versions are refused, so a tampered request cannot
 * be priced at an old, cheaper price list (code review of FLW-201).
 */
export const SUPERSEDED_GRACE_MS = 24 * 60 * 60 * 1000

/** Prices an estimator payload (`estimator_version`, `answers`, `defaulted`). Throws if the engine misbehaves. */
export async function priceEstimatorPayload(db: Db, p: Record<string, unknown>, now = Date.now()): Promise<PricedEstimate | PricingFailure> {
  const version = p.estimator_version
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return { error: 'unknown_version' }
  const row = await db.select().from(estimatorVersions).where(eq(estimatorVersions.version, version)).get()
  if (!row) return { error: 'unknown_version' }
  const next = await db.select({ publishedAt: estimatorVersions.publishedAt }).from(estimatorVersions).where(eq(estimatorVersions.version, version + 1)).get()
  if (next && now - next.publishedAt.getTime() > SUPERSEDED_GRACE_MS) return { error: 'outdated_version' }
  const doc = JSON.parse(row.documentJson) as EstimatorDocument
  const parsed = parseAnswers(doc, p.answers, p.defaulted)
  if (!parsed.ok) return { error: 'invalid_answers', errors: parsed.errors }
  const result = estimate(doc, parsed.answers)
  // PLAN.md "Output guard": never store or show a price that is not finite and ordered.
  if (!isSaneResult(result)) throw new Error(`estimator produced an unusable price for version ${version}: ${JSON.stringify(result)}`)
  return { version, doc, answers: parsed.answers, defaulted: parsed.defaulted, result, publicResult: toPublicResult(version, result) }
}

export const isPricingFailure = (x: PricedEstimate | PricingFailure): x is PricingFailure => 'error' in x

export function snapshotInsert(db: Db, e: PricedEstimate, ids: { leadId: string; submissionId: string; at: Date }) {
  const r = e.result
  return db.insert(estimateSnapshots).values({
    id: crypto.randomUUID(),
    leadId: ids.leadId,
    submissionId: ids.submissionId,
    version: e.version,
    engineRevision: ENGINE_REVISION,
    questionsJson: JSON.stringify(toPublic(e.doc, e.version).questions),
    answersJson: JSON.stringify(e.answers),
    defaultedJson: JSON.stringify(e.defaulted),
    lineItemsJson: JSON.stringify(r.lineItems),
    flagsJson: JSON.stringify(r.flags),
    low: r.low,
    mid: r.mid,
    high: r.high,
    belowMinimum: r.belowMinimum,
    sqft: r.sqft,
    railingLf: r.railingLf,
    serviceArea: r.serviceArea,
    createdAt: ids.at,
  })
}

export const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** The project type's label in that version, for the Lead's Service. */
export const projectTypeLabel = (e: PricedEstimate) =>
  e.doc.questions.find((q) => q.key === 'projectType')?.options?.find((o) => o.value === e.answers.projectType)?.label ?? null

/**
 * The Estimate email, rendered now and frozen into the job (Codex plan review round 1): a retry sends exactly this,
 * to the address given in this Form submission, with only what this Homeowner just saw.
 */
export function estimateEmail(settings: CompanySettings, e: PricedEstimate, to: string, firstName: string): Email {
  const r = e.publicResult
  const d = e.doc.copy.disclaimers
  const reviewNote = r.needsReview
    ? 'Some parts of your project need a site-specific review, so this range is wider than usual. We’ll firm it up at the site visit.'
    : ''
  const townhouseHoa = e.result.flags.some((f) => /townhouse|hoa/i.test(f)) ? `\n${d.townhouseHoa}` : ''
  const { subject, body } = renderTemplate(settings.estimateEmailTemplate, {
    // Plan 010 F6: the first name is public input sent from our domain; only a plain name is echoed back.
    first_name: /^[A-Za-z][A-Za-z'-]{0,39}$/.test(firstName) ? firstName : 'there',
    low: usd(r.low),
    high: usd(r.high),
    review_note: reviewNote + townhouseHoa,
    company_name: settings.name,
    company_phone: settings.phone ?? '',
    disclaimer: d.primary,
  })
  return { to, subject, text: body, ...(settings.email ? { replyTo: settings.email } : {}) }
}
