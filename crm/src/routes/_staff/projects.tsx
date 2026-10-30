import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ProjectChecklist } from '#/components/ProjectChecklist'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '#/components/ui/sheet'
import { errorMessage } from '#/lib/errors'
import { PROJECT_STEPS, PROJECT_STEP_LABELS, type ProjectStep } from '#/lib/project-steps'
import { listProjectBoard, moveJobStep } from '#/lib/projects.functions'
import { cn } from '#/lib/utils'

// The project board (GLOSSARY Project step): every won Job in a column per step, from waiting for the deposit to
// close-out. Drag a card to move it (or use its step picker on a phone); tap it for its checklist. Same layout as the
// Pipeline (crm.tsx).
export const Route = createFileRoute('/_staff/projects')({
  head: () => ({ meta: [{ title: 'Projects - Turner’s Decks CRM' }] }),
  loader: () => listProjectBoard(),
  component: ProjectBoard,
})

type Card = Awaited<ReturnType<typeof listProjectBoard>>[number]

const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function ProjectBoard() {
  const jobs = Route.useLoaderData()
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

  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col sm:-m-6">
      <div className="border-b">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 sm:px-6">
          <h1 className="text-lg font-semibold tracking-tight">Projects</h1>
        </div>
      </div>
      <div className="flex min-h-11 items-center border-b px-4 py-1.5 sm:px-6">
        <p className="text-sm font-semibold tabular-nums">
          {jobs.filter((j) => stepOf(j) !== 'done').length} open · {jobs.filter((j) => stepOf(j) === 'done').length} done in the last 60 days
        </p>
      </div>

      <div className="flex min-h-[360px] flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
        <div className="flex min-h-0 flex-1 snap-x snap-mandatory items-stretch gap-4 overflow-x-auto pb-2">
          {PROJECT_STEPS.map((step) => {
            const items = jobs.filter((j) => stepOf(j) === step)
            return (
              <section
                key={step}
                aria-label={PROJECT_STEP_LABELS[step]}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dropStep !== step) setDropStep(step)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = dragId
                  endDrag()
                  if (id) void move(id, step)
                }}
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
                        {j.progress.total > 0 && step !== 'done' && (
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
    </div>
  )
}
