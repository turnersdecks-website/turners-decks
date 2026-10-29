import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { insertLead } from './lead-helpers'
import { BASE, signedInStaff } from './staff'

// The pages render server side for a signed-in Staff member (mobile-friendly layout, company timezone).

const page = async (path: string, cookie: string) => {
  const res = await SELF.fetch(`${BASE}${path}`, { headers: { cookie } })
  expect(res.status).toBe(200)
  return res.text()
}

describe('Pipeline board /crm', () => {
  it('shows every Pipeline stage and the Lead in its column', async () => {
    const { cookie } = await signedInStaff('staff')
    await insertLead({ firstName: 'Quinn', lastName: 'Quoted', stage: 'quoted' })

    const html = await page('/crm', cookie)

    for (const label of ['New', 'Contacted', 'Appointment', 'Quoted', 'Won', 'Lost']) expect(html).toContain(label)
    expect(html).toMatch(/data-stage="quoted"(?:(?!data-stage=)[\s\S])*Quinn Quoted/)
  })
})

describe('Lead detail /leads/$id', () => {
  it('shows the Lead, its first-contact details, last update and activity', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead({ firstName: 'Dana', lastName: 'Detail' })
    await env.DB.prepare(
      `INSERT INTO lead_activity (id, lead_id, kind, body, follow_up_at, created_at) VALUES (?, ?, 'note', 'Wants a metal roof', ?, ?)`,
    )
      .bind(crypto.randomUUID(), id, Date.UTC(2026, 9, 20, 14), Date.UTC(2026, 9, 13, 14))
      .run()

    const html = await page(`/leads/${id}`, cookie)

    expect(html).toContain('Dana Detail')
    expect(html).toContain('Last updated')
    expect(html).toContain('website')
    expect(html).toContain('Wants a metal roof')
    // Follow-up shown in the company timezone (America/New_York): 14:00 UTC = 10:00 AM EDT.
    expect(html).toContain('Oct 20, 2026, 10:00 AM')
  })

  it('shows no Book appointment or Send mailer actions (not in v1)', async () => {
    const { cookie } = await signedInStaff('admin')
    const id = await insertLead({ firstName: 'Scope', lastName: 'Lead' })

    const html = await page(`/leads/${id}`, cookie)

    expect(html).not.toContain('Book appointment')
    expect(html).not.toContain('Send mailer')
  })

  it('offers Delete Lead to admins only', async () => {
    const admin = await signedInStaff('admin')
    const staff = await signedInStaff('staff')
    const id = await insertLead({ firstName: 'Del', lastName: 'Lead' })

    expect(await page(`/leads/${id}`, admin.cookie)).toContain('Delete Lead')
    expect(await page(`/leads/${id}`, staff.cookie)).not.toContain('Delete Lead')
  })

  // Plan 009 T1: underline tabs in `?tab=`, the Stage dropdown in the Homeowner card header (outside the form).
  const tabs = (html: string) =>
    [...html.matchAll(/<button\b([^>]*\brole="tab"[^>]*)>([^<]*)<\/button>/g)].map((m) => ({
      label: m[2],
      state: m[1].match(/data-state="(\w+)"/)?.[1],
    }))

  it('shows the Homeowner, Activities, Estimate, Quote and Photos tabs and the Stage control with the current stage', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead({ firstName: 'Tab', lastName: 'Lead', stage: 'quoted' })

    const html = await page(`/leads/${id}`, cookie)

    expect(html).toContain('role="tablist"')
    expect(tabs(html)).toEqual([
      { label: 'Homeowner', state: 'active' },
      { label: 'Activities', state: 'inactive' },
      { label: 'Estimate', state: 'inactive' },
      { label: 'Quote', state: 'inactive' },
      { label: 'Photos', state: 'inactive' },
    ])
    const stage = html.match(/<button\b[^>]*aria-label="Pipeline stage"[^>]*>[\s\S]*?<\/button>/)?.[0]
    expect(stage).toBeDefined()
    expect(stage).toContain('Quoted')
    expect(html).toMatch(/<label[^>]*for="lead-stage"[^>]*>Stage<\/label>/)
  })

  it('opens the tab named in ?tab= and falls back to Homeowner for an unknown one', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead({ firstName: 'Tab', lastName: 'Search' })

    const activities = tabs(await page(`/leads/${id}?tab=activities`, cookie))
    expect(activities.find((t) => t.label === 'Activities')?.state).toBe('active')
    expect(activities.find((t) => t.label === 'Homeowner')?.state).toBe('inactive')

    const unknown = tabs(await page(`/leads/${id}?tab=nope`, cookie))
    expect(unknown.find((t) => t.label === 'Homeowner')?.state).toBe('active')
  })

  it('keeps the Stage control outside the Homeowner form', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead({ firstName: 'Form', lastName: 'Stage' })

    const html = await page(`/leads/${id}`, cookie)

    const homeowner = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((m) => m[0]).find((f) => f.includes('name="firstName"'))
    expect(homeowner).toBeDefined()
    expect(html).toContain('aria-label="Pipeline stage"')
    expect(homeowner).not.toContain('Pipeline stage')
  })

  // Plan 009 T3: the Quote tab's five Quote file slots, current files only.
  it('opens the Quote tab with the five Quote file slots in order, a current file and its link, and no earlier files', async () => {
    const { cookie } = await signedInStaff('staff')
    const id = await insertLead({ firstName: 'Quote', lastName: 'Files' })
    const insert = (fileId: string, kind: string, name: string, removed: boolean) =>
      env.DB.prepare(
        `INSERT INTO lead_files (id, lead_id, kind, file_name, content_type, size_bytes, r2_key, uploaded_at, removed_at, removed_reason)
         VALUES (?, ?, ?, ?, 'application/pdf', 52000, ?, ?, ?, ?)`,
      )
        .bind(fileId, id, kind, name, `leads/${id}/${fileId}`, Date.UTC(2026, 9, 20, 14), removed ? Date.UTC(2026, 9, 21, 14) : null, removed ? 'replaced' : null)
        .run()
    const current = crypto.randomUUID()
    const earlier = crypto.randomUUID()
    await insert(earlier, 'signed_quote', 'old-signed.pdf', true)
    await insert(current, 'signed_quote', 'signed-quote-maria.pdf', false)

    const html = await page(`/leads/${id}?tab=quote`, cookie)

    expect(tabs(html).find((t) => t.label === 'Quote')?.state).toBe('active')
    const labels = ['Hover report', 'Materials list', 'Customer quote', 'Signed quote', 'Contractor agreement']
    const slots = [...html.matchAll(/data-quote-slot="(\w+)"[\s\S]*?<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[2])
    expect(slots).toEqual(labels)
    expect(html).toContain('signed-quote-maria.pdf')
    expect(html).toContain(`href="/api/lead-files/${current}"`)
    expect(html).not.toContain('old-signed.pdf')
    expect(html).not.toContain(earlier)
    expect(html).not.toContain('Earlier files')
  })

  it('says so when the Lead does not exist', async () => {
    const { cookie } = await signedInStaff('staff')

    expect(await page(`/leads/${crypto.randomUUID()}`, cookie)).toContain('Lead not found')
  })
})

describe('Settings /settings', () => {
  // Plan 006 S13: staff-role Staff see only "Your profile".
  it('shows a staff-role Staff member only their profile', async () => {
    const { cookie } = await signedInStaff('staff', { name: 'Dana Profile' })

    const html = await page('/settings', cookie)

    expect(html).toContain('Your profile')
    expect(html).toContain('Dana Profile')
    expect(html).not.toMatch(/Turner(&#x27;|')s Decks<\//)
    expect(html).not.toContain('Owner alert emails')
    expect(html).not.toContain('Save settings')
    expect(html).not.toContain('Save Estimate email')
  })

  it('lets an admin edit the Estimate email, with the placeholders it can use', async () => {
    const { cookie } = await signedInStaff('admin')

    const html = await page('/settings', cookie)

    expect(html).toContain('id="estimateEmailTemplate"')
    expect(html).toContain('Subject: Your deck estimate from {company_name}')
    for (const p of ['{first_name}', '{low}', '{high}', '{review_note}', '{company_phone}', '{disclaimer}']) expect(html).toContain(p)
    expect(html).toContain('Save Estimate email')
  })

  it('lets an admin edit the company and Owner alert emails, with no phone line or postcard sections', async () => {
    const { cookie } = await signedInStaff('admin')

    const html = await page('/settings', cookie)

    expect(html).toContain('Your profile')
    expect(html).toContain('Save settings')
    expect(html).toContain('Owner alert emails')
    expect(html).toMatch(/Turner(&#x27;|')s Decks/)
    expect(html).not.toContain('Appointment length')
    expect(html).not.toContain('Postcard template')
    expect(html).not.toContain('href="/mailers"')
  })
})
