import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'

// PLAN.md > Data model: company_settings is a single row (CHECK id=1), texting_enabled defaults to 0.

it('company settings is one row, id 1, with texting off', async () => {
  const rows = await env.DB.prepare('SELECT id, texting_enabled FROM company_settings').all()

  expect(rows.results).toEqual([{ id: 1, texting_enabled: 0 }])
})

it('a second company settings row is refused', async () => {
  await expect(env.DB.prepare(`INSERT INTO company_settings (id, name, timezone) VALUES (2, 'Other', 'UTC')`).run()).rejects.toThrow(
    /CHECK|UNIQUE/,
  )
})

it('has exactly the v1 columns', async () => {
  const cols = await env.DB.prepare(`SELECT name FROM pragma_table_info('company_settings') ORDER BY cid`).all<{ name: string }>()

  expect(cols.results.map((c) => c.name)).toEqual([
    'id',
    'name',
    'phone',
    'email',
    'service_area',
    'business_number',
    'timezone',
    'owner_alert_emails',
    'texting_enabled',
    'estimate_email_template', // FLW-200
    // Pine & Gable's Estimate, postcard and appointment columns come back (additive) with those features.
  ])
})

it('is seeded as Turner’s Decks in Eastern time, Owner alerts going to the company email', async () => {
  const row = await env.DB.prepare('SELECT name, email, timezone, owner_alert_emails FROM company_settings WHERE id = 1').first()

  expect(row).toEqual({ name: "Turner's Decks", email: 'turnersdecks@gmail.com', timezone: 'America/New_York', owner_alert_emails: null })
})
