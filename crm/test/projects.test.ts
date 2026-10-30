import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { moveLeadStage } from '#/lib/leads.functions'
import { CHECKLIST, checklistFor } from '#/lib/project-steps'
import { getJobChecklist, listProjectBoard, moveJobStep, tickChecklistItem } from '#/lib/projects.functions'
import { updateJob } from '#/lib/customers.functions'
import { randomPhone } from './intake-helpers'
import { insertLead } from './lead-helpers'
import { callServerFn, serverFnResult, signedInStaff } from './staff'

// GLOSSARY Project step: the project board and its checklists.

type Checklist = { step: string; items: { key: string; done: boolean; kind: string; step: string }[] }

async function wonJob(cookie: string) {
  const leadId = await insertLead({ phoneE164: `+1${randomPhone()}` })
  await serverFnResult(await callServerFn(moveLeadStage, cookie, { leadId, stage: 'won' }))
  return (await env.DB.prepare('SELECT id FROM jobs WHERE lead_id = ?').bind(leadId).first<string>('id'))!
}

const jobRow = (id: string) => env.DB.prepare('SELECT step, status, permit_pulled, finish_date FROM jobs WHERE id = ?').bind(id).first<Record<string, unknown>>()

describe('project checklist rules', () => {
  const base = { permitNeeded: false, hoaNeeded: false, township: null, startDate: null, permitPulled: false, hoaApproved: false, reviewAsked: false, reviewReceived: false, onWebsite: false, afterPhotoCount: 0 }
  it('leaves out permit and HOA items when the Job has neither', () => {
    const keys = checklistFor(base, new Set()).map((i) => i.key)
    expect(keys).not.toContain('permit_applied')
    expect(keys).not.toContain('hoa_approved')
    expect(keys).not.toContain('framing_inspection')
  })
  it('ticks automatic items from the Job', () => {
    const items = checklistFor({ ...base, permitNeeded: true, township: 'Exeter Township', startDate: '2026-11-02', afterPhotoCount: 3 }, new Set())
    expect(items.filter((i) => i.kind === 'auto').every((i) => i.done)).toBe(true)
  })
  it('every item key is unique', () => {
    expect(new Set(CHECKLIST.map((i) => i.key)).size).toBe(CHECKLIST.length)
  })
})

describe('project board', () => {
  it('a won Job starts at Waiting for deposit and shows on the board', async () => {
    const { cookie } = await signedInStaff('staff')
    const jobId = await wonJob(cookie)
    expect((await jobRow(jobId))?.step).toBe('deposit')
    const board = await serverFnResult<{ id: string; step: string; progress: { done: number; total: number } }[]>(await callServerFn(listProjectBoard, cookie))
    expect(board.find((j) => j.id === jobId)).toMatchObject({ step: 'deposit', progress: { done: 0, total: 2 } })
  })

  it('moving a Job moves its status; done gives it a finish date', async () => {
    const { cookie } = await signedInStaff('staff')
    const jobId = await wonJob(cookie)
    await serverFnResult(await callServerFn(moveJobStep, cookie, { jobId, step: 'build' }))
    expect(await jobRow(jobId)).toMatchObject({ step: 'build', status: 'in_progress' })
    await serverFnResult(await callServerFn(moveJobStep, cookie, { jobId, step: 'done' }))
    const done = await jobRow(jobId)
    expect(done).toMatchObject({ step: 'done', status: 'done' })
    expect(done?.finish_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await callServerFn(moveJobStep, cookie, { jobId, step: 'somewhere' })).status).toBe(400)
  })

  it('ticks a hand item, a Job-backed item, and refuses an automatic one', async () => {
    const { cookie } = await signedInStaff('staff')
    const jobId = await wonJob(cookie)
    await serverFnResult(await callServerFn(updateJob, cookie, { jobId, permitNeeded: true }))
    const a = await serverFnResult<Checklist>(await callServerFn(tickChecklistItem, cookie, { jobId, key: 'deposit_received', done: true }))
    expect(a.items.find((i) => i.key === 'deposit_received')?.done).toBe(true)
    await serverFnResult(await callServerFn(tickChecklistItem, cookie, { jobId, key: 'permit_approved', done: true }))
    expect((await jobRow(jobId))?.permit_pulled).toBe(1)
    expect((await callServerFn(tickChecklistItem, cookie, { jobId, key: 'township', done: true })).status).toBe(400)
    await serverFnResult(await callServerFn(updateJob, cookie, { jobId, township: 'Exeter Township' }))
    const c = await serverFnResult<Checklist>(await callServerFn(getJobChecklist, cookie, { jobId }))
    expect(c.items.find((i) => i.key === 'township')?.done).toBe(true)
    await serverFnResult(await callServerFn(tickChecklistItem, cookie, { jobId, key: 'deposit_received', done: false }))
    const d = await serverFnResult<Checklist>(await callServerFn(getJobChecklist, cookie, { jobId }))
    expect(d.items.find((i) => i.key === 'deposit_received')?.done).toBe(false)
  })

  it('setting a Job done from its form also finishes it on the board', async () => {
    const { cookie } = await signedInStaff('staff')
    const jobId = await wonJob(cookie)
    await serverFnResult(await callServerFn(updateJob, cookie, { jobId, status: 'done' }))
    expect((await jobRow(jobId))?.step).toBe('done')
  })
})
