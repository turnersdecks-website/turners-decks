import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/db/client'
import { crewReplyWrites, removeCrewTime, sendDueCheckins } from '#/lib/crew-time.server'
import { signQuoDelivery } from '#/lib/quo'

// crew-time.server.ts: the 6 PM build-day text to Pat, his reply read into crew time on the Job, FIX, two Jobs, and
// Pat's own texts never becoming a Lead.

const PAT = '+14845550142'
const OUR_NUMBER = '+14849393325'
const PN = 'PNcrew00000000000000000000000'
const SECRET = `whsec_${btoa('crew-signing-secret-0123456789abcd')}`
// 6:05 PM in Philadelphia on Fri Nov 20, 2026 (EST, UTC-5).
const SIX_PM = Date.UTC(2026, 10, 20, 23, 5)

async function makeJob(last: string, step = 'build') {
  const c = crypto.randomUUID()
  const j = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO customers (id, first_name, last_name, client_type, created_at, updated_at) VALUES (?, 'Pat', ?, 'residential', ?, ?)").bind(c, last, 1, 1).run()
  await env.DB.prepare("INSERT INTO jobs (id, customer_id, name, status, step, square_footage, created_at, updated_at) VALUES (?, ?, ?, 'in_progress', ?, 300, 1, 1)")
    .bind(j, c, `${last} deck`, step, )
    .run()
  return j
}
const ownerTexts = () =>
  env.DB.prepare("SELECT json_extract(payload_json, '$.content') AS content, dedupe_key FROM notification_jobs WHERE kind = 'sms_owner' ORDER BY created_at, rowid")
    .all<{ content: string; dedupe_key: string }>()
    .then((r) => r.results)
const crewRows = (jobId: string) =>
  env.DB.prepare('SELECT name, hours, pay_type, rate_cents, cost_cents, needs_review FROM crew_time WHERE job_id = ? ORDER BY rowid').bind(jobId).all<Record<string, any>>().then((r) => r.results)
const jobLabor = (jobId: string) => env.DB.prepare('SELECT actual_labor_hours, labor_cost_cents FROM jobs WHERE id = ?').bind(jobId).first<Record<string, any>>()

async function reply(text: string, now = SIX_PM + 60 * 60_000) {
  const db = getDb(env.DB)
  const ids: string[] = []
  const writes = await crewReplyWrites(db, text, PAT, now, ids)
  if (writes?.length) await db.batch(writes as never)
  return writes
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("UPDATE jobs SET step = 'closeout'"),
    env.DB.prepare('DELETE FROM crew_time'),
    env.DB.prepare('DELETE FROM crew_checkins'),
    env.DB.prepare('DELETE FROM crew_members'),
    env.DB.prepare("DELETE FROM notification_jobs WHERE kind = 'sms_owner'"),
    env.DB.prepare("UPDATE company_settings SET crew_checkin_enabled = 1, crew_checkin_hour = 18, texting_enabled = 1, owner_mobile = ?, timezone = 'America/New_York' WHERE id = 1").bind(PAT),
    env.DB.prepare("INSERT INTO crew_members (id, name, aliases, pay_type, rate_cents) VALUES ('t', 'Tommy', 'Tom', 'hourly', 2500), ('g', 'Gary', NULL, 'day', 22500), ('l', 'Lenny', NULL, NULL, NULL)"),
  ])
})

describe('Crew check-in', () => {
  it('texts Pat once per build Job at 6 PM, not before, not twice, and not when switched off', async () => {
    const job = await makeJob('Kondracki')
    await makeJob('Spencer', 'permit')
    expect(await sendDueCheckins(env, SIX_PM - 10 * 60_000)).toEqual({ sent: 0 })
    expect(await sendDueCheckins(env, SIX_PM)).toEqual({ sent: 1 })
    expect(await sendDueCheckins(env, SIX_PM + 5 * 60_000)).toEqual({ sent: 0 })
    const [text] = await ownerTexts()
    expect(text.content).toBe(
      'Kondracki deck: who worked today and how many hours? Reply like: Tommy 8, Gary 8. Add $ for a day amount (Gary $250) or a rate (Tommy 6 at $30). Reply NONE if nobody worked.',
    )
    expect(text.dedupe_key).toBe(`crew_checkin:${job}:2026-11-20`)
    await env.DB.prepare('UPDATE company_settings SET crew_checkin_enabled = 0 WHERE id = 1').run()
    await makeJob('Galman')
    expect(await sendDueCheckins(env, SIX_PM + 10 * 60_000)).toEqual({ sent: 0 })
  })

  it("reads Pat's reply into crew time, fills the Job's labor, and texts back what it recorded", async () => {
    const job = await makeJob('Kondracki')
    await sendDueCheckins(env, SIX_PM)
    await reply('Tommy 8, Gary $250, Lenny 6 at $30, Mike 8')
    expect(await crewRows(job)).toEqual([
      { name: 'Tommy', hours: 8, pay_type: 'hourly', rate_cents: 2500, cost_cents: 20000, needs_review: 0 },
      { name: 'Gary', hours: null, pay_type: 'day', rate_cents: 25000, cost_cents: 25000, needs_review: 0 },
      { name: 'Lenny', hours: 6, pay_type: 'hourly', rate_cents: 3000, cost_cents: 18000, needs_review: 0 },
      { name: 'Mike', hours: 8, pay_type: null, rate_cents: null, cost_cents: null, needs_review: 1 },
    ])
    expect(await jobLabor(job)).toEqual({ actual_labor_hours: 22, labor_cost_cents: 63000 })
    expect((await ownerTexts()).at(-1)!.content).toBe(
      'Got it for Kondracki deck, Fri 11/20: Tommy 8h at $25/hr, Gary $250 day, Lenny 6h at $30/hr, Mike 8h. Kristin will check: "Mike" isn\'t on the crew list. Reply FIX if that\'s wrong.',
    )
    // Removing every row clears the totals it filled.
    const ids = await env.DB.prepare('SELECT id FROM crew_time WHERE job_id = ?').bind(job).all<{ id: string }>()
    for (const r of ids.results) await removeCrewTime(getDb(env.DB), r.id)
    expect(await jobLabor(job)).toEqual({ actual_labor_hours: null, labor_cost_cents: null })
  })

  it('FIX clears the last reply so Pat can send it again; NONE and SAME work', async () => {
    const job = await makeJob('Kondracki')
    await sendDueCheckins(env, SIX_PM)
    await reply('Tommy 8')
    await reply('FIX')
    expect(await crewRows(job)).toEqual([])
    expect((await ownerTexts()).at(-1)!.content).toBe('OK, I cleared Kondracki deck for Fri 11/20. Send who worked and the hours again.')
    await reply('Tommy 7, Gary 8')
    expect((await crewRows(job)).map((r) => r.name)).toEqual(['Tommy', 'Gary'])

    // The next day: SAME copies Friday's crew.
    const SAT = SIX_PM + 24 * 60 * 60_000
    await sendDueCheckins(env, SAT)
    await reply('same', SAT + 60_000)
    expect((await crewRows(job)).length).toBe(4)
    // Sunday: nobody.
    await sendDueCheckins(env, SAT + 24 * 60 * 60_000)
    await reply('rain day', SAT + 24 * 60 * 60_000 + 60_000)
    expect((await crewRows(job)).length).toBe(4)
    expect((await ownerTexts()).at(-1)!.content).toBe('Got it: nobody worked on Kondracki deck Sun 11/22.')
  })

  it('with two Jobs, numbers the texts and his replies answer them in order (or by Job name)', async () => {
    const a = await makeJob('Adams')
    const b = await makeJob('Baker')
    await sendDueCheckins(env, SIX_PM)
    const texts = await ownerTexts()
    expect(texts.map((t) => t.content.split(':')[0])).toEqual(['Adams deck (1 of 2)', 'Baker deck (2 of 2)'])
    await reply('Baker: Gary 8')
    expect((await crewRows(b)).map((r) => r.name)).toEqual(['Gary'])
    expect((await ownerTexts()).at(-1)!.content).toMatch(/Next: Adams deck, who worked and how many hours\?$/)
    await reply('Tommy 8')
    expect((await crewRows(a)).map((r) => r.name)).toEqual(['Tommy'])
  })

  it("Pat's own texts never become a Lead, check-in or not", async () => {
    await env.DB.prepare(
      `INSERT INTO quo_connection (id, phone_number_id, phone_number_e164, webhook_id, signing_secret, connected_at) VALUES (1, ?, ?, '42', ?, ?)
       ON CONFLICT(id) DO UPDATE SET signing_secret = excluded.signing_secret, phone_number_id = excluded.phone_number_id`,
    )
      .bind(PN, OUR_NUMBER, SECRET, Date.now())
      .run()
    const id = `msg_${crypto.randomUUID()}`
    const ts = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({
      id: 'EV1',
      type: 'message.received',
      data: { resource: { id: `AC${crypto.randomUUID()}`, text: 'hey call me', createdAt: new Date().toISOString() }, context: { phoneNumberId: PN, senderIdentifier: PAT } },
    })
    const res = await SELF.fetch('http://localhost/api/public/quo-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': await signQuoDelivery(SECRET, id, ts, body) },
      body,
    })
    expect(res.status).toBe(200)
    expect(await env.DB.prepare('SELECT id FROM leads WHERE phone_e164 = ?').bind(PAT).first()).toBeNull()
  })
})
