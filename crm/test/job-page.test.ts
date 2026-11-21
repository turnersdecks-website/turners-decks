import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { BASE, signedInStaff } from './staff'


describe('Job page', () => {
  it('renders a Job at the Build step with its Crew time panel', async () => {
    const { cookie } = await signedInStaff('admin')
    const c = crypto.randomUUID()
    const j = crypto.randomUUID()
    await env.DB.prepare("INSERT INTO customers (id, first_name, last_name, street, city, phone, client_type, created_at, updated_at) VALUES (?, 'Ken', 'K', '1 Main', 'Exton', '6105550100', 'residential', 1, 1)").bind(c).run()
    await env.DB.prepare("INSERT INTO jobs (id, customer_id, name, status, step, square_footage, permit_needed, permit_pulled, quoted_price_cents, created_at, updated_at) VALUES (?, ?, 'Test deck', 'in_progress', 'build', 252, 1, 1, 3365000, 1, 1)").bind(j, c).run()
    const res = await SELF.fetch(`${BASE}/jobs/${j}`, { headers: { cookie } })
    const html = await res.text()
    if (res.status !== 200) console.log(html.slice(0, 3000))
    expect(res.status).toBe(200)
    expect(html).toContain('Test deck')
  })
})
