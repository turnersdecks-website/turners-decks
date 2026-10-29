// Job statuses (GLOSSARY Job). Their own module so the schema and client code share them without the client
// bundle importing the schema.
export const JOB_STATUSES = ['not_scheduled', 'scheduled', 'in_progress', 'done', 'on_hold', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]
/** Statuses that close a Job: a Lead won again after these starts a new Job (repeat work). */
export const CLOSED_JOB_STATUSES = ['done', 'cancelled'] as const satisfies readonly JobStatus[]
