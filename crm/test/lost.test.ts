import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/db/client'
import { markLost, previewLost } from '#/lib/lost.server'
import { moveLeadToStage } from '#/lib/leads.server'
import { dispatchDueJobs } from '#/lib/outbox'
import { insertLead, leadRow, stageChanges } from './lead-helpers'
import { mockResend, sendingEnv } from './outbox-helpers'

// src/lib/lost.server.ts: the Lost window.

const lostJobs = (leadId: string) =>
  env.DB.prepare("SELECT * FROM notification_jobs WHERE kind = 'lost_email' AND json_extract(payload_json, '$.lead_id') = ?")
    .bind(leadId)
    .all<Record<string, any>>()
    .then((r) => r.results.map((j) => ({ ...j, payload: JSON.parse(j.payload_json) })))
const activity = (leadId: string) =>
  env.DB.prepare('SELECT kind, body, dispatch_state FROM lead_activity WHERE lead_id = ? ORDER BY created_at, rowid').bind(leadId).all<Record<string, any>>().then((r) => r.results)

describe('Lost window', () => {
  it('shows the thank-you email with the Homeowner first name before anything is sent', async () => {
    const leadId = await insertLead({ firstName: 'Harry', email: `h-${crypto.randomUUID()}@example.com`, stage: 'quoted' })
    const p = await previewLost(getDb(env.DB), env, leadId)
    expect(p.subject).toMatch(/^Thanks for considering /)
    expect(p.body).toMatch(/^Hi Harry,/)
    expect(p.cannotSend).toBeNull()
    expect(await lostJobs(leadId)).toHaveLength(0)
    expect((await leadRow(leadId))!.stage).toBe('quoted')
  })

  it('moving to Lost with send ticked emails the Homeowner, marks Do not contact and keeps the reason', async () => {
    const email = `h-${crypto.randomUUID()}@example.com`
    const leadId = await insertLead({ firstName: 'Harry', email, stage: 'quoted' })
    const res = await markLost(getDb(env.DB), env, { leadId, sendEmail: true, doNotContact: true, reason: 'Went with another company' }, null)
    expect(res.emailQueued).toBe(true)
    const row = (await leadRow(leadId))!
    expect(row.stage).toBe('lost')
    expect(row.do_not_contact).toBe(1)
    expect((await stageChanges(leadId)).at(-1)).toMatchObject({ from_stage: 'quoted', to_stage: 'lost', reason: 'Went with another company' })

    const [job] = await lostJobs(leadId)
    expect(job.payload.to).toEqual([email])
    const resend = mockResend()
    await dispatchDueJobs(sendingEnv, { fetch: resend.fetch, now: () => Date.now() + 60_000 })
    const sent = resend.callsFor(job.id)
    expect(sent).toHaveLength(1)
    expect(sent[0].body.text).toContain('Hi Harry,')
    const acts = await activity(leadId)
    expect(acts.some((a) => a.kind === 'note' && a.body.includes('Marked Do not contact.'))).toBe(true)
    expect(acts.some((a) => a.kind === 'email' && a.dispatch_state === 'accepted' && a.body.startsWith('Thank-you email sent.'))).toBe(true)
  })

  it('moving to Lost without sending queues no email and can leave Do not contact off', async () => {
    const leadId = await insertLead({ email: `g-${crypto.randomUUID()}@example.com`, stage: 'contacted' })
    const res = await markLost(getDb(env.DB), env, { leadId, sendEmail: false, doNotContact: false }, null)
    expect(res.emailQueued).toBe(false)
    expect(await lostJobs(leadId)).toHaveLength(0)
    expect((await leadRow(leadId))!.do_not_contact).toBe(0)
  })

  it('a Lead moved back out of Lost before the email goes out gets nothing', async () => {
    const leadId = await insertLead({ email: `b-${crypto.randomUUID()}@example.com`, stage: 'quoted' })
    await markLost(getDb(env.DB), env, { leadId, sendEmail: true, doNotContact: true }, null)
    await env.DB.prepare("UPDATE notification_jobs SET state = 'pending', claimed_until = NULL WHERE kind = 'lost_email' AND json_extract(payload_json, '$.lead_id') = ?").bind(leadId).run()
    await moveLeadToStage(env.DB, leadId, 'quoted', null)
    const [job] = await lostJobs(leadId)
    const resend = mockResend()
    await dispatchDueJobs(sendingEnv, { fetch: resend.fetch, now: () => Date.now() + 60_000 })
    expect(resend.callsFor(job.id)).toHaveLength(0)
  })

  it('refuses to send to a Lead with no email or one already marked Do not contact', async () => {
    const db = getDb(env.DB)
    const noEmail = await insertLead({ stage: 'quoted' })
    expect((await previewLost(db, env, noEmail)).cannotSend).toBe('This Lead has no email address.')
    await expect(markLost(db, env, { leadId: noEmail, sendEmail: true, doNotContact: true }, null)).rejects.toBeInstanceOf(Response)

    const dnc = await insertLead({ email: `d-${crypto.randomUUID()}@example.com`, stage: 'quoted' })
    await env.DB.prepare('UPDATE leads SET do_not_contact = 1 WHERE id = ?').bind(dnc).run()
    expect((await previewLost(db, env, dnc)).cannotSend).toMatch(/already marked Do not contact/)
    await expect(markLost(db, env, { leadId: dnc, sendEmail: true, doNotContact: true }, null)).rejects.toBeInstanceOf(Response)
    expect((await leadRow(dnc))!.stage).toBe('quoted')
  })
})
