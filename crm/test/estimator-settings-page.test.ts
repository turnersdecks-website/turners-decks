import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getEstimatorSettings, saveEstimatorDraft } from '#/lib/estimator-settings.functions'
import type { EstimatorDocument } from '#/lib/estimator/document'
import { optionValueFor } from '#/lib/estimator/option-value'
import { BASE, callServerFn, serverFnResult, signedInStaff } from './staff'

// FLW-203: /settings/estimator, the owner's form over the Estimator settings draft.

const page = async (path: string, cookie: string) => {
  const res = await SELF.fetch(`${BASE}${path}`, { headers: { cookie } })
  expect(res.status).toBe(200)
  return res.text()
}

/** The HTML of one question's card. */
const questionCard = (html: string, key: string) => html.match(new RegExp(`data-question="${key}"[\\s\\S]*?(?=data-question="|id="prices")`))?.[0] ?? ''

describe('Estimator settings /settings/estimator', () => {
  it('shows an admin the live Published version, the questions by step, prices, and Save draft and Publish', async () => {
    const { cookie } = await signedInStaff('admin')

    const html = await page('/settings/estimator', cookie)

    expect(html).toContain('Estimator settings')
    expect(html).toContain('Live: Published version <!-- -->1')
    for (const step of ['Step 1: Project', 'Step 4: Material', 'Step 8: Finishing']) {
      expect(html).toContain(step)
    }
    expect(html).toContain('value="Which decking material?"')
    expect(html).toContain('Save draft')
    expect(html).toContain('Publish</button>')
    expect(html).not.toMatch(/<fieldset[^>]*disabled/)
    // Material's $/sq ft and pattern's percent, shown as a percent.
    expect(questionCard(html, 'material')).toContain('value="85"')
    expect(html).toContain('id="ranges-standard-0"')
    expect(html).toMatch(/id="ranges-standard-0"[^>]*value="90"|value="90"[^>]*id="ranges-standard-0"/)
  })

  it('offers Add an option only on lists the owner may add to, and Delete on none of the original options', async () => {
    const { cookie } = await signedInStaff('admin')

    const html = await page('/settings/estimator', cookie)

    expect(questionCard(html, 'material')).toContain('Add an option')
    expect(questionCard(html, 'railingStyle')).toContain('Add an option')
    expect(questionCard(html, 'projectType')).not.toContain('Add an option')
    expect(questionCard(html, 'stairCount')).not.toContain('Add an option')
    expect(html).not.toContain('aria-label="Delete')
    // Answers the estimator's math uses are marked and cannot be removed.
    expect(questionCard(html, 'demolition')).toContain('Required')
  })

  it('offers Delete on an option the owner added, and shows Unpublished changes until it is published', async () => {
    const { cookie } = await signedInStaff('admin')
    const s = await serverFnResult<{ draft: EstimatorDocument; revision: number }>(await callServerFn(getEstimatorSettings, cookie))
    const doc = s.draft
    doc.questions.find((q) => q.key === 'material')!.options!.push({ value: 'trexTranscend', label: 'Trex Transcend', enabled: true, price: { newPerSqft: 110, redeckPerSqft: 50 } })
    await serverFnResult(await callServerFn(saveEstimatorDraft, cookie, { document: doc, revision: s.revision }))

    const html = await page('/settings/estimator', cookie)

    expect(html).toContain('Unpublished changes')
    expect(questionCard(html, 'material')).toContain('aria-label="Delete “Trex Transcend”"')
    expect(questionCard(html, 'material')).toContain('value="110"')
  })

  it('lets a staff-role Staff member look but not change anything', async () => {
    const { cookie } = await signedInStaff('staff')

    const html = await page('/settings/estimator', cookie)

    expect(html).toContain('Live: Published version')
    expect(html).toContain('value="Which decking material?"')
    expect(html).toMatch(/<fieldset[^>]*disabled/)
    expect(html).not.toContain('Save draft')
    expect(html).not.toContain('Publish</button>')
    expect(html).not.toContain('Add an option')
  })
})

describe('a new option’s stored value', () => {
  it('is the label in camelCase, made unique in its list', () => {
    expect(optionValueFor('Trex Transcend', [])).toBe('trexTranscend')
    expect(optionValueFor('Trex Transcend', ['trexTranscend'])).toBe('trexTranscend2')
    expect(optionValueFor('Trex Transcend', ['trexTranscend', 'trexTranscend2'])).toBe('trexTranscend3')
    expect(optionValueFor('Cable rail (stainless!)', [])).toBe('cableRailStainless')
    expect(optionValueFor('!!!', [])).toBe('option')
    expect(optionValueFor('a'.repeat(60), [])).toHaveLength(36)
  })
})
