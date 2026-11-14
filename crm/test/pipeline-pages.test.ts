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

describe('Leads /leads: one page, Board and List', () => {
  it('the board shows the open stages as columns with the Lead in its column, and Won and Lost as drop targets', async () => {
    const { cookie } = await signedInStaff('staff')
    await insertLead({ firstName: 'Quinn', lastName: 'Quoted', stage: 'quoted' })
    await insertLead({ firstName: 'Wanda', lastName: 'Won', stage: 'won' })

    const html = await page('/leads?view=board', cookie)

    for (const label of ['New', 'Contacted', 'Appointment', 'Quoted', 'Won', 'Lost']) expect(html).toContain(label)
    expect(html).toMatch(/data-stage="quoted"(?:(?!data-stage=)[\s\S])*Quinn Quoted/)
    expect(html).not.toContain('Wanda Won')
    expect(html).toContain('Drop a Lead here')
  })

  it('a desktop opens on the board and a phone on the list; a saved choice wins', async () => {
    const { cookie } = await signedInStaff('staff')
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
    const get = (headers: Record<string, string>) => SELF.fetch(`${BASE}/leads`, { headers: { cookie, ...headers } }).then((r) => r.text())

    expect(await get({})).toContain('Drop a Lead here')
    expect(await get({ 'user-agent': iphone })).toContain('role="tablist"')
    expect(await get({ cookie: `${cookie}; leads_view=board`, 'user-agent': iphone })).toContain('Drop a Lead here')
  })

  it('the list shows open Leads by default, and Won, Lost and All on their tabs', async () => {
    const { cookie } = await signedInStaff('staff')
    await insertLead({ firstName: 'Olive', lastName: 'Open', stage: 'contacted' })
    await insertLead({ firstName: 'Lou', lastName: 'Lost', stage: 'lost' })

    const open = await page('/leads?view=list', cookie)
    expect(open).toContain('Olive Open')
    expect(open).not.toContain('Lou Lost')
    const lost = await page('/leads?view=list&show=lost', cookie)
    expect(lost).toContain('Lou Lost')
    expect(lost).not.toContain('Olive Open')
    const all = await page('/leads?view=list&show=all', cookie)
    expect(all).toContain('Olive Open')
    expect(all).toContain('Lou Lost')
  })

  it('old links to the Pipeline, Projects and Customers land on the new pages', async () => {
    const { cookie } = await signedInStaff('staff')
    const go = (path: string) => SELF.fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' })
    for (const [from, to] of [['/crm', '/leads?view=board'], ['/projects', '/jobs?view=board'], ['/customers', '/contacts']]) {
      const res = await go(from)
      expect(res.status).toBeGreaterThanOrEqual(300)
      expect(res.status).toBeLessThan(400)
      expect(new URL(res.headers.get('location')!, BASE).pathname + new URL(res.headers.get('location')!, BASE).search).toBe(to)
    }
  })
})

describe('Contacts /contacts', () => {
  it('lists Customers and Leads with no Customer, each with its worked-out type and marketing flags', async () => {
    const { cookie } = await signedInStaff('staff')
    const customerId = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO customers (id, first_name, last_name, phone, phone_e164, ok_to_contact, client_type, created_at, updated_at)
       VALUES (?, 'Carla', 'Customer', '(610) 555-0177', '+16105550177', 1, 'residential', ?, ?)`,
    )
      .bind(customerId, Date.now(), Date.now())
      .run()
    await insertLead({ firstName: 'Olga', lastName: 'Openlead', stage: 'new' })
    const lost = await insertLead({ firstName: 'Dina', lastName: 'Dnc', stage: 'lost' })
    await env.DB.prepare('UPDATE leads SET do_not_contact = 1 WHERE id = ?').bind(lost).run()

    const html = await page('/contacts', cookie)

    expect(html).toMatch(/data-type="customer"(?:(?!data-type=)[\s\S])*Carla Customer/)
    expect(html).toMatch(/data-type="open_lead"(?:(?!data-type=)[\s\S])*Olga Openlead/)
    expect(html).toMatch(/data-type="closed_lead"(?:(?!data-type=)[\s\S])*Dina Dnc(?:(?!data-type=)[\s\S])*Do not contact/)
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

describe('Settings /settings and Your profile /profile', () => {
  it('sends a staff-role Staff member from Settings to their profile, which shows only their name', async () => {
    const { cookie } = await signedInStaff('staff', { name: 'Dana Profile' })

    const res = await SELF.fetch(`${BASE}/settings`, { headers: { cookie }, redirect: 'manual' })
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(new URL(res.headers.get('location')!, BASE).pathname).toBe('/profile')
    const html = await page('/profile', cookie)
    expect(html).toContain('Your profile')
    expect(html).toContain('Dana Profile')
    expect(html).not.toContain('Owner alert emails')
  })

  it('opens on the Company tab: company info, Owner alert emails and the Photo home screen, no phone line or postcard sections', async () => {
    const { cookie } = await signedInStaff('admin')

    const html = await page('/settings', cookie)

    for (const tab of ['Company', 'Automations', 'Connections']) expect(html).toContain(tab)
    expect(html).toContain('Save settings')
    expect(html).toContain('Owner alert emails')
    expect(html).toContain('Photo home screen')
    expect(html).not.toContain('Customer email templates')
    expect(html).not.toContain('Appointment length')
    expect(html).not.toContain('Postcard template')
  })

  it('Automations holds the Customer email templates, with the Website calculator email and its placeholders, and texting', async () => {
    const { cookie } = await signedInStaff('admin')

    const html = await page('/settings?tab=automations', cookie)

    expect(html).toContain('Customer email templates')
    expect(html).toContain('id="estimateEmailTemplate"')
    expect(html).toContain('Subject: Your deck estimate from {company_name}')
    for (const p of ['{first_name}', '{low}', '{high}', '{review_note}', '{company_phone}', '{disclaimer}']) expect(html).toContain(p)
    expect(html).toContain('Website calculator email')
    expect(html).toContain('Texting')
    expect(html).not.toContain('Owner alert emails')
  })

  it('Connections holds Quo and QuickBooks', async () => {
    const { cookie } = await signedInStaff('admin')

    const html = await page('/settings?tab=connections', cookie)

    expect(html).toContain('Quo (phone and texting)')
    expect(html).toContain('QuickBooks')
  })
})
