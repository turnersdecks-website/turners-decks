import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/db/client'
import { markLeadReviewed } from '#/lib/leads.server'
import { insertLead, leadRow } from './lead-helpers'

describe('Needs review', () => {
  it('Mark reviewed clears the flag and logs who did it', async () => {
    const leadId = await insertLead({ firstName: 'Rev' })
    await env.DB.prepare('UPDATE leads SET needs_review = 1 WHERE id = ?').bind(leadId).run()
    await markLeadReviewed(getDb(env.DB), leadId, null)
    expect((await leadRow(leadId))!.needs_review).toBe(0)
    const note = await env.DB.prepare("SELECT body FROM lead_activity WHERE lead_id = ? AND kind = 'note'").bind(leadId).first('body')
    expect(note).toBe('Marked reviewed.')
  })
})
