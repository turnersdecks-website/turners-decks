import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { sendAppointmentDigest } from '#/lib/appointment-digest.server'
import { runScheduled, OUTBOX_CRON } from '#/lib/cron'

// appointment-digest.server.ts: the 6 PM text to Pat listing tomorrow's appointments.

const PAT = '+14845550142'
const KRISTIN = '+16105550177'
// 6:05 PM in Philadelphia on Fri Nov 27, 2026 (EST, UTC-5).
const FRI_6PM = Date.UTC(2026, 10, 27, 23, 5)
// Sat Nov 28, 2026 in Philadelphia.
const SAT = (h: number, m = 0) => Date.UTC(2026, 10, 28, h + 5, m)

async function lead(first: string, last: string, at: number | null, extra: { street?: string; city?: string; phone?: string } = {}) {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO leads (id, first_name, last_name, stage, phone, phone_e164, street, city, appointment_at, source, first_source, created_at, updated_at)
     VALUES (?, ?, ?, 'appointment', ?, ?, ?, ?, ?, 'website', 'website', 1, 1)`,
  )
    .bind(id, first, last, extra.phone ?? null, extra.phone ? `+1${extra.phone}` : null, extra.street ?? null, extra.city ?? null, at)
    .run()
  return id
}
const digests = () =>
  env.DB.prepare("SELECT json_extract(payload_json, '$.to') AS too, json_extract(payload_json, '$.content') AS content FROM notification_jobs WHERE dedupe_key LIKE 'appt_digest:%' ORDER BY rowid")
    .all<{ too: string; content: string }>()
    .then((r) => r.results)

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('UPDATE leads SET appointment_at = NULL'),
    env.DB.prepare("DELETE FROM notification_jobs WHERE dedupe_key LIKE 'appt_digest:%'"),
    env.DB.prepare(
      "UPDATE company_settings SET appointment_digest_enabled = 1, appointment_digest_to = NULL, texting_enabled = 1, owner_mobile = ?, timezone = 'America/New_York' WHERE id = 1",
    ).bind(PAT),
  ])
})

describe("Tomorrow's appointments text", () => {
  it("texts Pat once at 6 PM with tomorrow's appointments in time order, and not before 6 PM", async () => {
    const powell = await lead('Leslieann', 'Powell', SAT(10), { street: '12 Main St', city: 'Royersford', phone: '6105550101' })
    const smith = await lead('Jane', 'Smith', SAT(8, 30), { city: 'Exeter' })
    await lead('Sunday', 'Person', SAT(34)) // Sunday 10 AM: not tomorrow
    expect(await sendAppointmentDigest(env, FRI_6PM - 10 * 60_000)).toEqual({ sent: 0 })
    expect(await sendAppointmentDigest(env, FRI_6PM)).toEqual({ sent: 1 })
    expect(await sendAppointmentDigest(env, FRI_6PM + 5 * 60_000)).toEqual({ sent: 0 })
    const [text] = await digests()
    expect(text.too).toBe(PAT)
    expect(text.content).toBe(
      [
        'Tomorrow, Saturday, November 28: 2 appointments.',
        `8:30 AM Jane Smith\nExeter\n${env.BETTER_AUTH_URL}/leads/${smith}`,
        `10:00 AM Leslieann Powell\n12 Main St, Royersford\n(610) 555-0101\n${env.BETTER_AUTH_URL}/leads/${powell}`,
      ].join('\n\n'),
    )
  })

  it('sends nothing on a day with no appointments, or when switched off or texting is off', async () => {
    expect(await sendAppointmentDigest(env, FRI_6PM)).toEqual({ sent: 0 })
    await lead('Leslieann', 'Powell', SAT(10))
    await env.DB.prepare('UPDATE company_settings SET appointment_digest_enabled = 0 WHERE id = 1').run()
    expect(await sendAppointmentDigest(env, FRI_6PM)).toEqual({ sent: 0 })
    await env.DB.prepare('UPDATE company_settings SET appointment_digest_enabled = 1, texting_enabled = 0 WHERE id = 1').run()
    expect(await sendAppointmentDigest(env, FRI_6PM)).toEqual({ sent: 0 })
    expect(await digests()).toEqual([])
  })

  it('goes to every number in "Text appointments to" instead of Pat when that list is set', async () => {
    await lead('Leslieann', 'Powell', SAT(10))
    await env.DB.prepare('UPDATE company_settings SET appointment_digest_to = ? WHERE id = 1').bind(`${PAT},${KRISTIN}`).run()
    expect(await sendAppointmentDigest(env, FRI_6PM)).toEqual({ sent: 2 })
    expect((await digests()).map((d) => d.too)).toEqual([PAT, KRISTIN])
  })

  it('a cancelled appointment is left out', async () => {
    await lead('Leslieann', 'Powell', SAT(10))
    await env.DB.prepare('UPDATE leads SET appointment_at = NULL').run()
    expect(await sendAppointmentDigest(env, FRI_6PM)).toEqual({ sent: 0 })
  })

  it('runs from the 5-minute cron', async () => {
    await lead('Leslieann', 'Powell', SAT(10))
    await runScheduled(OUTBOX_CRON, env, { now: () => FRI_6PM, fetch: async () => new Response('{}', { status: 500 }) }).catch(() => undefined)
    expect(await digests()).toHaveLength(1)
  })
})
