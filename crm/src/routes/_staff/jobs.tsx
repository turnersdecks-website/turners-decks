import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ShowTabs, ViewToggle } from '#/components/board-views'
import { DataTable, DataTableColumnHeader } from '#/components/data-table'
import { StatCard, StatGrid } from '#/components/page'
import { ProjectChecklist } from '#/components/ProjectChecklist'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '#/components/ui/sheet'
import { JOB_STATUSES, JOB_STATUS_LABELS, JOB_STATUS_STYLES, customerName, formatMoney, jobMetrics } from '#/lib/customer-vocab'
import { listJobs } from '#/lib/customers.functions'
import { errorMessage } from '#/lib/errors'
import { PROJECT_STEPS, PROJECT_STEP_LABELS, type ProjectStep } from '#/lib/project-steps'
import { listProjectBoard, moveJobStep } from '#/lib/projects.functions'
import { cn } from '#/lib/utils'
import { readDefaultView } from '#/lib/view-pref.functions'
import { type BoardView, parseBoardView } from '#/lib/view-pref'

// Jobs (GLOSSARY): one page, two views (the project board replaced /projects).
// - Board: every open Job in a column per Project step, Waiting for deposit to Close out; Done is a narrow drop
//   target with a count (Jobs finished in the last 60 days). Tap a card for its checklist.
// - List: the Jobs table with the Airtable tracker's totals (square footage, quoted, labor hours per 100 sq ft, margin)
//   over the Jobs shown. Open by default, with Done / Cancelled / All tabs.
const SHOW_TABS = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
] as const
type Show = (typeof SHOW_TABS)[number]['id']
const parseShow = (v: unknown): Show | undefined => (SHOW_TABS.some((t) => t.id === v) ? (v as Show) : undefined)
const BOARD_STEPS = PROJECT_STEPS.filter((s) => s !== 'done')

export const Route = createFileRoute('/_staff/jobs')({
  validateSearch: (s: Record<string, unknown>): { view?: BoardView; show?: Show } => ({ view: parseBoardView(s.view), show: parseShow(s.show) }),
  head: () => ({ meta: [{ title: 'Jobs - Turner’s Decks CRM' }] }),
  beforeLoad: () => ({ defaultView: readDefaultView('jobs') }),
  loader: async () => {
    const [rows, board] = await Promise.all([listJobs(), listProjectBoard()])
    return { rows, board }
  },
  component: JobsPage,
})

type JobRow = Awaited<ReturnType<typeof listJobs>>[number]
type Card = Awaited<ReturnType<typeof listProjectBoard>>[number]

const isOpenStatus = (s: JobRow['job']['status']) => s !== 'done' && s !== 'cancelled'

function JobsPage() {
  const { rows, board } = Route.useLoaderData()
  const { defaultView } = Route.useRouteContext()
  const search = Route.useSearch()
  const view = search.view ?? defaultView
  const show = search.show ?? 'open'

  const counts: Record<Show, number> = {
    open: rows.filter((r) => isOpenStatus(r.job.status)).length,
    done: rows.filter((r) => r.job.status === 'done').length,
    cancelled: rows.filter((r) => r.job.status === 'cancelled').length,
    all: rows.length,
  }

  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col sm:-m-6">
      <div className="border-b">
        <div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2 sm:px-6">
          <h1 className="text-lg font-semibold tracking-tight">Jobs</h1>
          <ViewToggle page="jobs" view={view} />
        </div>
      </div>
      {view === 'board' ? (
        <JobBoard jobs={board} />
      ) : (
        <>
          <div className="flex min-h-11 items-center border-b px-4 py-1.5 sm:px-6">
            <ShowTabs tabs={SHOW_TABS} value={show} counts={counts} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <p className="mb-4 text-sm text-muted-foreground">A Job is added when a Lead is won, or from a Customer's page.</p>
            <JobList key={show} rows={rows.filter((r) => show === 'all' || (show === 'open' ? isOpenStatus(r.job.status) : r.job.status === show))} />
          </div>
        </>
      )}
    </div>
  )
}

const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function JobBoard({ jobs }: { jobs: Card[] }) {
  const router = useRouter()
  const [moved, setMoved] = useState<Record<string, ProjectStep>>({})
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropStep, setDropStep] = useState<ProjectStep | null>(null)
  const [openJob, setOpenJob] = useState<Card | null>(null)

  const stepOf = (j: Card) => moved[j.id] ?? j.step
  const refresh = () => router.invalidate()

  async function move(id: string, step: ProjectStep) {
    setMoved((m) => ({ ...m, [id]: step }))
    try {
      await moveJobStep({ data: { jobId: id, step } })
      await refresh()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setMoved(({ [id]: _, ...rest }) => rest)
    }
  }

  const endDrag = () => {
    setDragId(null)
    setDropStep(null)
  }
  const dropHandlers = (step: ProjectStep) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropStep !== step) setDropStep(step)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      const id = dragId
      endDrag()
      if (id) void move(id, step)
    },
  })
  const doneCount = jobs.filter((j) => stepOf(j) === 'done').length

  return (
    <>
      <div className="flex min-h-11 items-center border-b px-4 py-1.5 sm:px-6">
        <p className="text-sm font-semibold tabular-nums">
          {jobs.length - doneCount} open · {doneCount} done in the last 60 days
        </p>
      </div>
      <div className="flex min-h-[360px] flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
        <div className="flex min-h-0 flex-1 snap-x snap-mandatory items-stretch gap-4 overflow-x-auto pb-2">
          {BOARD_STEPS.map((step) => {
            const items = jobs.filter((j) => stepOf(j) === step)
            return (
              <section
                key={step}
                data-step={step}
                aria-label={PROJECT_STEP_LABELS[step]}
                {...dropHandlers(step)}
                className={cn(
                  'flex h-full min-h-0 w-[85vw] max-w-[300px] shrink-0 snap-start flex-col overflow-hidden rounded-t-2xl border-x border-t bg-background sm:w-[260px]',
                  dropStep === step && 'border-primary/50 bg-primary/5',
                )}
              >
                <div className="flex min-h-14 items-center gap-2 border-b bg-muted/50 px-3 py-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold text-muted-foreground" aria-hidden>
                    {PROJECT_STEPS.indexOf(step) + 1}
                  </span>
                  <h2 className="text-sm font-semibold">{PROJECT_STEP_LABELS[step]}</h2>
                  <span className="rounded-full bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">{items.length}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {items.length === 0 && <div className="min-h-28 rounded-xl border border-dashed border-border/70" aria-hidden />}
                  <ul className="flex flex-col gap-3">
                    {items.map((j) => (
                      <li
                        key={j.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', j.id)
                          setDragId(j.id)
                        }}
                        onDragEnd={endDrag}
                        className={cn(
                          'cursor-grab rounded-xl border bg-card p-3 shadow-xs transition hover:border-primary/40 hover:shadow-md active:cursor-grabbing',
                          dragId === j.id && 'scale-[0.98] opacity-55',
                        )}
                      >
                        <button type="button" onClick={() => setOpenJob(j)} className="block w-full text-left">
                          <p className="truncate text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{j.customerName}</p>
                          <h3 className="mt-1 line-clamp-2 text-sm font-semibold">{j.name}</h3>
                          {j.town && <p className="mt-0.5 truncate text-xs text-muted-foreground">{j.town}</p>}
                        </button>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {j.permitNeeded && <span className="rounded border px-1.5 py-0.5 font-medium">Permit</span>}
                          {j.hoaNeeded && <span className="rounded border px-1.5 py-0.5 font-medium">HOA</span>}
                          {j.startDate && (
                            <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium">
                              <CalendarDays className="size-3" aria-hidden />
                              {shortDate(j.startDate)}
                            </span>
                          )}
                        </div>
                        {j.progress.total > 0 && (
                          <div className="mt-2.5 flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                              <div className="h-full rounded-full bg-primary" style={{ width: `${(100 * j.progress.done) / j.progress.total}%` }} />
                            </div>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {j.progress.done}/{j.progress.total}
                            </span>
                          </div>
                        )}
                        <label className="mt-2.5 block sm:hidden">
                          <span className="sr-only">Project step</span>
                          <select
                            value={stepOf(j)}
                            onChange={(e) => void move(j.id, e.target.value as ProjectStep)}
                            className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                          >
                            {PROJECT_STEPS.map((s) => (
                              <option key={s} value={s}>
                                {PROJECT_STEP_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )
          })}

          {/* Done: a drop target with a count, not a column of cards. */}
          <section
            data-step="done"
            aria-label={PROJECT_STEP_LABELS.done}
            {...dropHandlers('done')}
            className={cn(
              'flex w-[85vw] max-w-[300px] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-4 text-center sm:w-[170px]',
              dropStep === 'done' ? 'border-primary/60 bg-primary/5' : 'border-border/70',
            )}
          >
            <h2 className="text-sm font-semibold">Done</h2>
            <p className="text-2xl font-semibold tabular-nums">{doneCount}</p>
            <p className="text-[11px] text-muted-foreground">in the last 60 days. Drop a Job here</p>
            <Link to="/jobs" search={{ view: 'list', show: 'done' }} className="mt-1 text-xs font-medium underline underline-offset-2">
              See the list
            </Link>
          </section>
        </div>
      </div>

      <Sheet open={Boolean(openJob)} onOpenChange={(v) => !v && setOpenJob(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {openJob && (
            <>
              <SheetHeader>
                <SheetTitle>{openJob.name}</SheetTitle>
                <SheetDescription>
                  {openJob.customerName} ·{' '}
                  <Link to="/jobs/$id" params={{ id: openJob.id }} className="underline">
                    Open the Job
                  </Link>
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <ProjectChecklist key={openJob.id} jobId={openJob.id} onChanged={() => void refresh()} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

const JOBS_CAP = 500

const average = (values: (number | null)[]) => {
  const xs = values.filter((v): v is number => v !== null)
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null
}

function JobList({ rows }: { rows: JobRow[] }) {
  const metrics = rows.map((r) => jobMetrics(r.job))
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0)
  const totalSqft = sum(rows.map((r) => r.job.squareFootage))
  const totalQuoted = sum(rows.map((r) => r.job.quotedPriceCents))
  const avgLabor = average(metrics.map((m) => m.laborHoursPer100Sqft))
  const avgMargin = average(metrics.map((m) => m.grossMarginPct))
  const towns = [...new Set(rows.map((r) => r.job.city).filter((v): v is string => !!v))].sort()
  const statuses = [...new Set(rows.map((r) => r.job.status))]

  const columns: ColumnDef<JobRow, unknown>[] = [
    {
      id: 'name',
      accessorFn: (r) => r.job.name,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Job" />,
      cell: ({ row }) => (
        <Link to="/jobs/$id" params={{ id: row.original.job.id }} className="font-medium hover:underline">
          {row.original.job.name}
        </Link>
      ),
      meta: { label: 'Job', mobile: 'title' },
    },
    {
      id: 'customer',
      accessorFn: (r) => customerName({ firstName: r.customerFirstName, lastName: r.customerLastName }),
      header: 'Customer',
      cell: ({ row }) => (
        <Link to="/customers/$id" params={{ id: row.original.job.customerId }} className="hover:underline">
          {customerName({ firstName: row.original.customerFirstName, lastName: row.original.customerLastName })}
        </Link>
      ),
    },
    { id: 'city', accessorFn: (r) => r.job.city ?? '', header: 'Town' },
    {
      id: 'status',
      accessorFn: (r) => r.job.status,
      header: 'Status',
      cell: ({ row }) => (
        <span className={cn('rounded-md border px-1.5 py-0.5 text-xs text-nowrap', JOB_STATUS_STYLES[row.original.job.status])}>{JOB_STATUS_LABELS[row.original.job.status]}</span>
      ),
      enableGlobalFilter: false,
    },
    {
      id: 'startDate',
      accessorFn: (r) => r.job.startDate ?? '',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Start" />,
      cell: ({ row }) => <span className="text-nowrap">{row.original.job.startDate}</span>,
      enableGlobalFilter: false,
      meta: { label: 'Start' },
    },
    {
      id: 'quotedPrice',
      accessorFn: (r) => r.job.quotedPriceCents ?? 0,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Quoted" />,
      cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.job.quotedPriceCents)}</span>,
      enableGlobalFilter: false,
      meta: { label: 'Quoted' },
    },
    {
      id: 'margin',
      accessorFn: (r) => jobMetrics(r.job).grossMarginPct ?? -1,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Margin" />,
      cell: ({ row }) => {
        const pct = jobMetrics(row.original.job).grossMarginPct
        return <span className="tabular-nums">{pct === null ? '' : `${pct}%`}</span>
      },
      enableGlobalFilter: false,
      meta: { label: 'Margin' },
    },
  ]

  return (
    <>
      {rows.length > 0 && (
        <StatGrid>
          <StatCard label="Square footage" value={totalSqft.toLocaleString('en-US')} hint="Jobs on this tab" />
          <StatCard label="Quoted" value={formatMoney(totalQuoted) || '$0'} hint="Jobs on this tab" />
          <StatCard label="Labor hours per 100 sq ft" value={avgLabor ?? '–'} hint="Average of Jobs with hours and size" />
          <StatCard label="Gross margin" value={avgMargin === null ? '–' : `${avgMargin}%`} hint="Average of Jobs with costs filled in" />
        </StatGrid>
      )}
      <DataTable
        label="Jobs"
        columns={columns}
        data={rows}
        getRowId={(r) => r.job.id}
        rowProps={(r) => ({ 'data-status': r.job.status })}
        search={{ placeholder: 'Search Job, Customer or town' }}
        facets={[
          ...(statuses.length > 1
            ? [{ columnId: 'status', title: 'Status', options: JOB_STATUSES.filter((s) => statuses.includes(s)).map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] })) }]
            : []),
          ...(towns.length ? [{ columnId: 'city', title: 'Town', options: towns.map((t) => ({ value: t, label: t })) }] : []),
        ]}
        empty="No Jobs here. Move a Lead to Won, or add a Job from a Customer's page."
        cap={JOBS_CAP}
      />
    </>
  )
}
