import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { AlertCircle, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { LeadFieldsForm, emptyLead, useLeadFields } from '#/components/LeadForm'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { toast } from 'sonner'
import type { PipelineStage } from '#/db/schema'
import { errorMessage } from '#/lib/errors'
import { getCronHealth } from '#/lib/cron-health.functions'
import { createLead, listPipeline, moveLeadStage } from '#/lib/leads.functions'
import { STAGES, STAGE_LABELS, STAGE_STYLES, leadName } from '#/lib/pipeline'
import { cn } from '#/lib/utils'

// Pipeline board (port of the Lovable /crm, laid out as the Admin Kit issue-kanban-1): one column per Pipeline stage,
// each header shows its Lead count. Pine & Gable's Lead value (from saved Estimates) comes back with Estimates. Drag a card
// to move it on a desktop (native HTML5 drag and drop); on a phone the columns scroll sideways and each card has a
// stage picker. "+ New Lead" opens a dialog (as Lovable).
export const Route = createFileRoute('/_staff/crm')({
  head: () => ({ meta: [{ title: 'Pipeline - Turner’s Decks CRM' }] }),
  loader: async () => {
    const [leads, cron] = await Promise.all([listPipeline(), getCronHealth()])
    return { leads, cronStale: cron.stale, stuckJobs: cron.stuckJobs, stuckSubmissions: cron.stuckSubmissions }
  },
  component: PipelineBoard,
})

type BoardLead = Awaited<ReturnType<typeof listPipeline>>[number]

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

function PipelineBoard() {
  const { leads, cronStale, stuckJobs, stuckSubmissions } = Route.useLoaderData()
  const router = useRouter()
  const [moved, setMoved] = useState<Record<string, PipelineStage>>({})
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropStage, setDropStage] = useState<PipelineStage | null>(null)
  const [adding, setAdding] = useState(false)
  const [fields, setFields] = useLeadFields()

  const stageOf = (l: BoardLead) => moved[l.id] ?? l.stage

  async function move(id: string, stage: PipelineStage) {
    setMoved((m) => ({ ...m, [id]: stage }))
    try {
      await moveLeadStage({ data: { leadId: id, stage } })
      if (stage === 'won') toast.success('Won. Added to Customers with a new Job.')
      await router.invalidate()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setMoved(({ [id]: _, ...rest }) => rest)
    }
  }

  function endDrag() {
    setDragId(null)
    setDropStage(null)
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    try {
      await createLead({ data: fields })
      toast.success('Lead added')
      setAdding(false)
      setFields(emptyLead)
      await router.invalidate()
    } catch (error) {
      toast.error(await errorMessage(error))
    }
  }

  const alerts = [
    cronStale && 'Background jobs have not run in the last 15 minutes. Emails may be delayed. Tell an admin.',
    stuckJobs > 0 &&
      `${stuckJobs === 1 ? '1 email has' : `${stuckJobs} emails have`} failed for over an hour. An admin can check the Worker logs.`,
    stuckSubmissions > 0 &&
      `${stuckSubmissions === 1 ? '1 website form has' : `${stuckSubmissions} website forms have`} not been processed for over 15 minutes. An admin can check Submissions.`,
  ].filter((a): a is string => Boolean(a))

  return (
    // Full-bleed: cancel <main>'s padding so the kit header rules run edge to edge; the board scrolls sideways inside.
    <div className="-m-4 flex min-h-0 flex-1 flex-col sm:-m-6">
      <div className="border-b">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 sm:px-6">
          <h1 className="text-lg font-semibold tracking-tight">Pipeline</h1>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden />
            New Lead
          </Button>
        </div>
      </div>
      <div className="flex min-h-11 items-center border-b px-4 py-1.5 sm:px-6">
        <p className="text-sm font-semibold tabular-nums">
          {leads.length} {leads.length === 1 ? 'Lead' : 'Leads'}
        </p>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2 border-b px-4 py-3 sm:px-6">
          {alerts.map((text) => (
            <Alert key={text} variant="destructive" className="bg-destructive/10">
              <AlertCircle className="size-4" aria-hidden />
              <AlertDescription>{text}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      <div className="flex min-h-[360px] flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
        {leads.length === 0 && <p className="mb-4 text-sm text-muted-foreground">No Leads yet.</p>}
        <div className="flex min-h-0 flex-1 snap-x snap-mandatory items-stretch gap-4 overflow-x-auto pb-2 xl:snap-none">
          {STAGES.map((stage) => {
            const items = leads.filter((l) => stageOf(l) === stage)
            const styles = STAGE_STYLES[stage]
            return (
              <section
                key={stage}
                data-stage={stage}
                aria-label={STAGE_LABELS[stage]}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dropStage !== stage) setDropStage(stage)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = dragId
                  endDrag()
                  if (id) move(id, stage)
                }}
                className={cn(
                  'flex h-full min-h-0 w-[85vw] max-w-[300px] shrink-0 snap-start flex-col overflow-hidden rounded-t-2xl border-x border-t bg-background sm:w-[280px] xl:w-auto xl:min-w-[240px] xl:max-w-none xl:flex-1',
                  dropStage === stage && 'border-primary/50 bg-primary/5',
                )}
              >
                <div className="sticky top-0 z-10 flex min-h-14 flex-col justify-center gap-0.5 rounded-t-2xl border-b bg-muted/50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={cn('size-2 shrink-0 rounded-full', styles.dot)} aria-hidden />
                    <h2 className="text-sm font-semibold">{STAGE_LABELS[stage]}</h2>
                    <span className="rounded-full bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                      {items.length}
                    </span>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {items.length === 0 && (
                    <div className="min-h-28 rounded-xl border border-dashed border-border/70" aria-hidden />
                  )}
                  <ul className="flex flex-col gap-3">
                    {items.map((l) => (
                      <li
                        key={l.id}
                        data-kanban-card="true"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', l.id)
                          setDragId(l.id)
                        }}
                        onDragEnd={endDrag}
                        className={cn(
                          'group relative cursor-grab rounded-xl border bg-card p-3 shadow-xs transition hover:border-primary/40 hover:shadow-md active:cursor-grabbing',
                          dragId === l.id && 'scale-[0.98] opacity-55',
                        )}
                      >
                        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {l.source}
                        </p>
                        <h3 className="mt-1 line-clamp-2 text-sm font-semibold">
                          <Link to="/leads/$id" params={{ id: l.id }} className="hover:underline">
                            {leadName(l)}
                          </Link>
                        </h3>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {[l.street, l.city].filter(Boolean).join(', ') || l.email || l.phone}
                        </p>
                        {l.needsReview && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant="destructive">Needs review</Badge>
                          </div>
                        )}
                        <div className="mt-3 flex items-center gap-2 xl:justify-between">
                          <span
                            className={cn(
                              // Below xl the stage picker shows the stage, so the chip would repeat it.
                              'hidden h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium xl:inline-flex',
                              styles.chip,
                            )}
                          >
                            <span className={cn('size-1.5 rounded-full', styles.dot)} aria-hidden />
                            {STAGE_LABELS[stageOf(l)]}
                          </span>
                          <label className="min-w-0 flex-1 xl:hidden">
                            <span className="sr-only">Pipeline stage</span>
                            <select
                              value={stageOf(l)}
                              onChange={(e) => move(l.id, e.target.value as PipelineStage)}
                              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                            >
                              {STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {STAGE_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </label>
                          {l.assigneeName ? (
                            <span className="flex min-w-0 max-w-[50%] items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="truncate">{l.assigneeName}</span>
                              <Avatar className="size-7 border border-background shadow-sm" aria-hidden>
                                <AvatarFallback className="text-[10px] font-semibold">
                                  {initials(l.assigneeName)}
                                </AvatarFallback>
                              </Avatar>
                            </span>
                          ) : (
                            <span
                              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground"
                              aria-hidden
                            >
                              <Users className="size-3.5" />
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Lead</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Source: manual entry</p>
          <form onSubmit={add} className="space-y-4">
            <LeadFieldsForm value={fields} onChange={setFields} />
            <Button className="w-full">Save Lead</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
