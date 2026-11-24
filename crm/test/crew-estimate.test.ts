import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/db/client'
import { jobFinancials, profitAndLoss } from '#/lib/qbo.server'

// qbo.server.ts crewEstimates: running numbers during a Job. Crew time not verified as paid yet counts as an estimate,
// less crew payments already in QuickBooks on the Job that no crew time is linked to, so nothing is counted twice.

async function makeJob(last: string) {
  const c = crypto.randomUUID()
  const j = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO customers (id, first_name, last_name, client_type, created_at, updated_at) VALUES (?, 'Ken', ?, 'residential', 1, 1)").bind(c, last).run()
  await env.DB.prepare("INSERT INTO jobs (id, customer_id, name, status, step, square_footage, created_at, updated_at) VALUES (?, ?, ?, 'in_progress', 'build', 250, 1, 1)")
    .bind(j, c, `${last} deck`)
    .run()
  return j
}
const crew = (job: string, cents: number, date = '2026-11-23', paidVia: string | null = null) =>
  env.DB.prepare(
    "INSERT INTO crew_time (id, job_id, name, work_date, hours, pay_type, rate_cents, cost_cents, needs_review, source, paid_via, created_at) VALUES (?, ?, 'Gary', ?, 8, 'day', ?, ?, 0, 'manual', ?, 1)",
  )
    .bind(crypto.randomUUID(), job, date, cents, cents, paidVia)
    .run()
const cost = (job: string, cents: number, account: string, date = '2026-11-16') => {
  const id = `Purchase:${crypto.randomUUID()}`
  return env.DB.prepare(
    "INSERT INTO qbo_transactions (id, entity, qbo_id, kind, txn_date, amount_cents, account, deleted, synced_at, assignment, job_id) VALUES (?, 'Purchase', ?, 'cost', ?, ?, ?, 0, 1, 'job', ?)",
  )
    .bind(id, id, date, cents, account, job)
    .run()
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM crew_time'), env.DB.prepare('DELETE FROM qbo_transactions')])
})

describe('Running Job numbers with crew time not paid yet', () => {
  it("counts unverified crew time as an estimate, less a crew Venmo already in QuickBooks (Ken's job: $6,650 total)", async () => {
    const job = await makeJob('Kondracki')
    await cost(job, 1_010_548, 'Job Supplies')
    await cost(job, 45_000, 'Contractors')
    await crew(job, 665_000)
    const fin = await jobFinancials(getDb(env.DB), job)
    expect(fin.totals).toMatchObject({
      costCents: 1_055_548,
      crewUnverifiedCents: 665_000,
      crewUnlinkedPayCents: 45_000,
      crewEstimateCents: 620_000,
      allInCostCents: 1_055_548,
      estimatedCostCents: 1_675_548,
    })
  })

  it('verified crew time is not estimated again', async () => {
    const job = await makeJob('Spencer')
    await crew(job, 50_000, '2026-11-20', 'outside')
    const fin = await jobFinancials(getDb(env.DB), job)
    expect(fin.totals).toMatchObject({ crewOutsideCents: 50_000, crewEstimateCents: 0, estimatedCostCents: 50_000 })
  })

  it('the estimate never goes below zero when QuickBooks crew pay is more than the logged time', async () => {
    const job = await makeJob('Galman')
    await cost(job, 90_000, 'Contractors')
    await crew(job, 45_000)
    expect((await jobFinancials(getDb(env.DB), job)).totals.crewEstimateCents).toBe(0)
  })

  it('the P&L counts the estimate in the month the crew worked, and on a finished Job', async () => {
    const job = await makeJob('Roy')
    await cost(job, 45_000, 'Contractors', '2026-10-30')
    await crew(job, 30_000, '2026-10-30')
    await crew(job, 70_000, '2026-11-02')
    await env.DB.prepare("UPDATE jobs SET status = 'done', step = 'done', finish_date = '2026-11-05' WHERE id = ?").bind(job).run()
    const pnl = await profitAndLoss(getDb(env.DB), 2026)
    const oct = pnl.months.find((m) => m.month === '2026-10')!
    const nov = pnl.months.find((m) => m.month === '2026-11')!
    // $1,000 logged less $450 paid = $550 estimate, spread 30/70 over October and November.
    expect(oct.crewEstimateCents + nov.crewEstimateCents).toBe(55_000)
    expect(oct.crewEstimateCents).toBe(16_500)
    expect(oct.jobCostCents).toBe(45_000 + 16_500)
    expect(pnl.completedJobs.find((j) => j.id === job)).toMatchObject({ costCents: 45_000 + 55_000, crewEstimateCents: 55_000 })
  })
})
