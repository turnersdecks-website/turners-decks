import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { getDb } from '#/db/client'
import {
  type CrewRowInput,
  type ManualCrewInput,
  addCrewTime,
  checkinText,
  clearCrewTimeReview,
  crewPayCandidates,
  type VerifyCrewInput,
  unverifyCrewPay,
  verifyCrewPay,
  listJobCrewTime,
  readCrewSettings,
  removeCrewTime,
  saveCrewSettings,
} from '#/lib/crew-time.server'
import { requireAdmin, requireStaff } from '#/lib/guards'
import { record, requiredId } from '#/lib/input'

// Crew time (crew-time.server.ts): Settings > Company > Crew (admins) and the Job page's Crew time panel (Staff).

export const getCrewSettings = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async () => {
    const s = await readCrewSettings(getDb(env.DB))
    return { ...s, preview: checkinText('Kondracki deck', s.crew.filter((c) => c.active).map((c) => c.name.split(/\s+/)[0])) }
  })

export const saveCrewSettingsFn = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { enabled: boolean; hour: number; crew: CrewRowInput[] }) => record(data))
  .handler(({ data }) => saveCrewSettings(getDb(env.DB), { enabled: data.enabled, hour: data.hour, crew: data.crew }))

export const getJobCrewTime = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { jobId: string }) => record(data))
  .handler(({ data }) => listJobCrewTime(getDb(env.DB), requiredId(data.jobId)))

export const addCrewTimeFn = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: ManualCrewInput) => record(data))
  .handler(({ data, context: { staff } }) => addCrewTime(getDb(env.DB), { ...(data as unknown as ManualCrewInput), jobId: requiredId(data.jobId) }, staff.id))

export const removeCrewTimeFn = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { id: string }) => record(data))
  .handler(({ data }) => removeCrewTime(getDb(env.DB), requiredId(data.id)))

export const clearCrewReviewFn = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { id: string }) => record(data))
  .handler(({ data }) => clearCrewTimeReview(getDb(env.DB), requiredId(data.id)))

export const getCrewPayCandidates = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { id: string }) => record(data))
  .handler(({ data }) => crewPayCandidates(getDb(env.DB), requiredId(data.id)))

export const verifyCrewPayFn = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: VerifyCrewInput) => record(data))
  .handler(({ data, context: { staff } }) => verifyCrewPay(getDb(env.DB), data as unknown as VerifyCrewInput, staff.id))

export const unverifyCrewPayFn = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { id: string }) => record(data))
  .handler(({ data }) => unverifyCrewPay(getDb(env.DB), requiredId(data.id)))
