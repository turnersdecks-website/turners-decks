import { describe, expect, it } from 'vitest'
import { EMAIL_TEMPLATES } from '#/lib/email-templates'
import { listEmailTemplates, saveEmailTemplate } from '#/lib/email-templates.functions'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// GLOSSARY Customer email template.

type Row = { key: string; template: string; isDefault: boolean }

describe('customer email templates', () => {
  it('lists every template with its default until one is saved, and Reset goes back to the default', async () => {
    const { cookie } = await signedInStaff('admin')
    const before = await serverFnResult<Row[]>(await callServerFn(listEmailTemplates, cookie))
    expect(before.map((t) => t.key)).toEqual(EMAIL_TEMPLATES.map((t) => t.key))

    await serverFnResult(await callServerFn(saveEmailTemplate, cookie, { key: 'review_request', template: 'Subject: Thanks!\nHi {first_name}' }))
    const saved = (await serverFnResult<Row[]>(await callServerFn(listEmailTemplates, cookie))).find((t) => t.key === 'review_request')
    expect(saved).toMatchObject({ template: 'Subject: Thanks!\nHi {first_name}', isDefault: false })

    await serverFnResult(await callServerFn(saveEmailTemplate, cookie, { key: 'review_request', template: null }))
    const reset = (await serverFnResult<Row[]>(await callServerFn(listEmailTemplates, cookie))).find((t) => t.key === 'review_request')
    expect(reset?.isDefault).toBe(true)
  })

  it('is admin only and refuses unknown templates and empty text', async () => {
    const { cookie: staff } = await signedInStaff('staff')
    expect((await callServerFn(listEmailTemplates, staff)).status).toBe(403)
    const { cookie } = await signedInStaff('admin')
    expect((await callServerFn(saveEmailTemplate, cookie, { key: 'nope', template: 'x' })).status).toBe(400)
    expect((await callServerFn(saveEmailTemplate, cookie, { key: 'review_request', template: '  ' })).status).toBe(400)
  })
})

describe('do not contact', () => {
  it('Staff flag a Lead to leave it out of marketing, and can clear it', async () => {
    const { env } = await import('cloudflare:test')
    const { setDoNotContact } = await import('#/lib/leads.functions')
    const { insertLead, leadRow } = await import('./lead-helpers')
    const { cookie } = await signedInStaff('staff')
    const leadId = await insertLead({ stage: 'lost' })
    await serverFnResult(await callServerFn(setDoNotContact, cookie, { leadId, value: true }))
    expect((await leadRow(leadId))?.do_not_contact).toBe(1)
    await serverFnResult(await callServerFn(setDoNotContact, cookie, { leadId, value: false }))
    expect((await leadRow(leadId))?.do_not_contact).toBe(0)
    expect((await callServerFn(setDoNotContact, cookie, { leadId, value: 'yes' })).status).toBe(400)
    expect(env).toBeDefined()
  })
})
