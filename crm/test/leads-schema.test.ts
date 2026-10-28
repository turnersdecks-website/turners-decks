import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'

function insertLead(cols: { phone_e164?: string | null; email_lower?: string | null; stage?: string }) {
  return env.DB.prepare(
    `INSERT INTO leads (id, phone_e164, email_lower, stage, source, first_source)
     VALUES (?, ?, ?, ?, 'website', 'website')`,
  )
    .bind(crypto.randomUUID(), cols.phone_e164 ?? null, cols.email_lower ?? null, cols.stage ?? 'new')
    .run()
}

it('two Leads cannot share a phone_e164', async () => {
  await insertLead({ phone_e164: '+16105550100' })
  await expect(insertLead({ phone_e164: '+16105550100' })).rejects.toThrow(/UNIQUE/)
})

it('two Leads cannot share an email_lower', async () => {
  await insertLead({ email_lower: 'dup@example.com' })
  await expect(insertLead({ email_lower: 'dup@example.com' })).rejects.toThrow(/UNIQUE/)
})

it('many Leads may have no phone and no email (indexes are partial)', async () => {
  await insertLead({})
  await expect(insertLead({})).resolves.toBeTruthy()
})

it('stage only accepts the six Pipeline stages', async () => {
  for (const stage of ['new', 'contacted', 'appointment', 'quoted', 'won', 'lost']) {
    await expect(insertLead({ stage })).resolves.toBeTruthy()
  }
  await expect(insertLead({ stage: 'status' })).rejects.toThrow(/CHECK/)
})
