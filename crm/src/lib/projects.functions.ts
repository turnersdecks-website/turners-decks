import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { requireStaff } from '#/lib/guards'
import { record, requiredId } from '#/lib/input'
import { jobChecklist, moveJobToStep, projectBoard, setChecklistItem } from '#/lib/projects.server'

// The project board (GLOSSARY Project step) for the CRM pages. Any Staff member moves Jobs and ticks items.

export const listProjectBoard = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(() => projectBoard(env.DB))

export const getJobChecklist = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { jobId: string }) => record(data))
  .handler(({ data }) => jobChecklist(env.DB, requiredId(data.jobId)))

export const moveJobStep = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { jobId: string; step: string }) => record(data))
  .handler(({ data }) => moveJobToStep(env.DB, requiredId(data.jobId), data.step))

export const tickChecklistItem = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { jobId: string; key: string; done: boolean }) => record(data))
  .handler(({ data, context: { staff } }) => setChecklistItem(env.DB, requiredId(data.jobId), data.key, data.done, staff.id))
