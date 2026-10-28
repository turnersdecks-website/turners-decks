import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'

// PLAN.md > Data model: lead_activity, consent_events, notification_jobs.

async function aLead() {
  const id = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO leads (id, source, first_source) VALUES (?, 'website', 'website')`).bind(id).run()
  return id
}

function addActivity(leadId: string, kind: string, dedupeKey: string | null = null) {
  return env.DB.prepare(`INSERT INTO lead_activity (id, lead_id, kind, body, dedupe_key, created_at) VALUES (?, ?, ?, 'x', ?, 1)`)
    .bind(crypto.randomUUID(), leadId, kind, dedupeKey)
    .run()
}

function addConsent(cols: { event?: string; source?: string; program?: string; leadId?: string | null }) {
  return env.DB.prepare(
    `INSERT INTO consent_events (id, phone_e164, program, event, occurred_at, disclosure_version, source, source_ref, lead_id, recorded_at)
     VALUES (?, '+16105550100', ?, ?, 1, 'v1', ?, 'ref', ?, 2)`,
  )
    .bind(crypto.randomUUID(), cols.program ?? 'sms_followup', cols.event ?? 'grant', cols.source ?? 'form', cols.leadId ?? null)
    .run()
}

function addJob(cols: { state?: string; dedupeKey: string }) {
  return env.DB.prepare(
    `INSERT INTO notification_jobs (id, kind, payload_json, dedupe_key, state, attempts, next_attempt_at) VALUES (?, 'owner_alert', '{}', ?, ?, 0, 1)`,
  )
    .bind(crypto.randomUUID(), cols.dedupeKey, cols.state ?? 'pending')
    .run()
}

it('lead_activity kind is one of note, text, call, email, form', async () => {
  const lead = await aLead()
  for (const kind of ['note', 'text', 'call', 'email', 'form']) await expect(addActivity(lead, kind)).resolves.toBeTruthy()
  await expect(addActivity(lead, 'visit')).rejects.toThrow(/CHECK/)
})

it('lead_activity dedupe_key is unique when set, optional otherwise', async () => {
  const lead = await aLead()
  await addActivity(lead, 'form', 'form:abc')
  await expect(addActivity(lead, 'form', 'form:abc')).rejects.toThrow(/UNIQUE/)
  await addActivity(lead, 'note')
  await expect(addActivity(lead, 'note')).resolves.toBeTruthy()
})

it('deleting a Lead deletes its activity but keeps its consent events', async () => {
  const lead = await aLead()
  await addActivity(lead, 'form')
  await addConsent({ leadId: lead })
  await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(lead).run()

  const activity = await env.DB.prepare('SELECT COUNT(*) AS n FROM lead_activity WHERE lead_id = ?').bind(lead).first<{ n: number }>()
  expect(activity?.n).toBe(0)
  const consent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM consent_events WHERE source_ref = 'ref' AND lead_id IS NULL`).first<{ n: number }>()
  expect(consent?.n).toBeGreaterThan(0)
})

it('consent_events only take grant|revoke, form|text|staff and the two programs', async () => {
  await expect(addConsent({ event: 'revoke', source: 'text', program: 'sms_alerts' })).resolves.toBeTruthy()
  await expect(addConsent({ source: 'staff' })).resolves.toBeTruthy()
  await expect(addConsent({ event: 'maybe' })).rejects.toThrow(/CHECK/)
  await expect(addConsent({ source: 'web3forms' })).rejects.toThrow(/CHECK/)
  await expect(addConsent({ program: 'marketing' })).rejects.toThrow(/CHECK/)
})

it('notification_jobs states are pending|claimed|sent|failed|dead and dedupe_key is unique', async () => {
  for (const state of ['pending', 'claimed', 'sent', 'failed', 'dead']) {
    await expect(addJob({ state, dedupeKey: `k-${state}` })).resolves.toBeTruthy()
  }
  await expect(addJob({ state: 'queued', dedupeKey: 'k-queued' })).rejects.toThrow(/CHECK/)
  await expect(addJob({ dedupeKey: 'k-pending' })).rejects.toThrow(/UNIQUE/)
})
