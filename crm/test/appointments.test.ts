import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/db/client'
import { REMINDER_BEFORE_MS, bookAppointment, cancelAppointment } from '#/lib/appointments.server'
import { dispatchDueJobs } from '#/lib/outbox'
import { insertLead, leadRow, stageChanges } from './lead-helpers'
import { mockResend, sendingEnv } from './outbox-helpers'

// src/lib/appointments.server.ts: booking a consultation sends the confirmation now and the reminder 24 hours before.

const DAY = 24 * 60 * 60_000
const phone = () => `+1484${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`
const apptJobs = (leadId: string) =>
  env.DB.prepare("SELECT * FROM notification_jobs WHERE kind LIKE 'appointment_%' AND json_extract(payload_json, '$.lead_id') = ? ORDER BY created_at, rowid")
    .bind(leadId)
    .all<Record<string, any>>()
    .then((r) => r.results.map((j) => ({ ...j, payload: JSON.parse(j.payload_json) })))

describe('Appointments', () => {
  it('booking sends the confirmation now, waits to send the reminder until 24 hours before, and moves the Lead to Appointment', async () => {
    const now = Date.UTC(2030, 10, 20, 15, 0)
    const at = Date.UTC(2030, 10, 30, 15, 0) // Saturday, November 30, 2030, 10:00 AM in Philadelphia
    const mobile = phone()
    const leadId = await insertLead({ firstName: 'Leslie', email: `l-${crypto.randomUUID()}@example.com`, phoneE164: mobile, stage: 'contacted' })
    const res = await bookAppointment(getDb(env.DB), env, { leadId, at, sendEmail: true, sendText: true }, null, now)
    expect(res.reminderAt?.getTime()).toBe(at - REMINDER_BEFORE_MS)

    const jobs = await apptJobs(leadId)
    expect(jobs.map((j) => `${j.payload.which} ${j.kind}`).sort()).toEqual([
      'confirmation appointment_email',
      'confirmation appointment_text',
      'reminder appointment_email',
      'reminder appointment_text',
    ])
    const confirm = jobs.find((j) => j.kind === 'appointment_email' && j.payload.which === 'confirmation')!
    expect(confirm.payload.text).toContain('Saturday, November 30 at 10:00 AM at 12 Main St, Douglassville')
    expect(jobs.find((j) => j.kind === 'appointment_text' && j.payload.which === 'reminder')!.payload.content).toMatch(/^Hi Leslie, a reminder from .*tomorrow, Saturday, November 30, at 10:00 AM.*Reply STOP to opt out\.$/)
    for (const j of jobs) expect(j.next_attempt_at).toEqual(j.payload.which === 'reminder' ? at - REMINDER_BEFORE_MS : expect.any(Number))
    expect((await leadRow(leadId))!.stage).toBe('appointment')
    expect((await stageChanges(leadId)).at(-1)).toMatchObject({ from_stage: 'contacted', to_stage: 'appointment' })
    const consent = await env.DB.prepare('SELECT event, source FROM consent_events WHERE phone_e164 = ?').bind(mobile).all()
    expect(consent.results).toEqual([{ event: 'grant', source: 'staff' }])
  })

  it('the reminder email goes out once it is due, and not before', async () => {
    const now = Date.now()
    const at = now + 3 * DAY
    const leadId = await insertLead({ firstName: 'Rita', email: `r-${crypto.randomUUID()}@example.com` })
    await bookAppointment(getDb(env.DB), env, { leadId, at, sendEmail: true, sendText: false }, null, now)
    const reminder = (await apptJobs(leadId)).find((j) => j.payload.which === 'reminder')!
    const resend = mockResend()
    await dispatchDueJobs(sendingEnv, { fetch: resend.fetch, now: () => at - REMINDER_BEFORE_MS - 60_000 })
    expect(resend.callsFor(reminder.id)).toHaveLength(0)
    await dispatchDueJobs(sendingEnv, { fetch: resend.fetch, now: () => at - REMINDER_BEFORE_MS + 60_000 })
    expect(resend.callsFor(reminder.id)).toHaveLength(1)
    expect(resend.callsFor(reminder.id)[0].body.subject).toBe('See you tomorrow, Rita')
  })

  it('moving the appointment cancels the old reminder; cancelling it leaves nothing waiting', async () => {
    const now = Date.now()
    const leadId = await insertLead({ email: `m-${crypto.randomUUID()}@example.com` })
    const db = getDb(env.DB)
    await bookAppointment(db, env, { leadId, at: now + 5 * DAY, sendEmail: true, sendText: false }, null, now)
    await bookAppointment(db, env, { leadId, at: now + 6 * DAY, sendEmail: true, sendText: false }, null, now + 1)
    const waiting = (await apptJobs(leadId)).filter((j) => j.state === 'pending' && j.payload.which === 'reminder')
    expect(waiting.map((j) => j.payload.at)).toEqual([now + 6 * DAY])
    await cancelAppointment(db, leadId, null)
    const after = await apptJobs(leadId)
    expect(after.filter((j) => j.payload.which === 'reminder').every((j) => j.outcome === 'cancelled')).toBe(true)
    expect((await leadRow(leadId))!.appointment_at).toBeNull()
  })

  it('a number that texted STOP is never texted; a reminder too close to the appointment is skipped', async () => {
    const now = Date.now()
    const mobile = phone()
    const leadId = await insertLead({ phoneE164: mobile, email: `s-${crypto.randomUUID()}@example.com` })
    await env.DB.prepare("INSERT INTO consent_events (id, phone_e164, program, event, occurred_at, source, recorded_at) VALUES (?, ?, 'sms_followup', 'revoke', ?, 'text', ?)")
      .bind(crypto.randomUUID(), mobile, now - 1000, now - 1000)
      .run()
    await expect(bookAppointment(getDb(env.DB), env, { leadId, at: now + 3 * DAY, sendEmail: true, sendText: true }, null, now)).rejects.toBeInstanceOf(Response)
    const res = await bookAppointment(getDb(env.DB), env, { leadId, at: now + DAY + 60 * 60_000, sendEmail: true, sendText: false }, null, now)
    expect(res.reminderAt).toBeNull()
    expect((await apptJobs(leadId)).map((j) => j.payload.which)).toEqual(['confirmation'])
  })
})
