import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertCircle, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ShowTabs, ViewToggle } from '#/components/board-views'
import { DataTable, DataTableColumnHeader } from '#/components/data-table'
import { LeadFieldsForm, emptyLead, useLeadFields } from '#/components/LeadForm'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import type { PipelineStage } from '#/db/schema'
import { getCronHealth } from '#/lib/cron-health.functions'
import { customerName } from '#/lib/customer-vocab'
import { listCustomers } from '#/lib/customers.functions'
import { formatWhen } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'
import { createLead, listPipeline, moveLeadStage } from '#/lib/leads.functions'
import { CLOSED_STAGES, OPEN_STAGES, STAGES, STAGE_LABELS, STAGE_STYLES, isOpenStage, leadName } from '#/lib/pipeline'
import { getCompanySettings } from '#/lib/settings.functions'
import { channelLabel, reportedSource } from '#/lib/lead-origin'
import { cn } from '#/lib/utils'
import { readDefaultView } from '#/lib/view-pref.functions'
import { type BoardView, parseBoardView } from '#/lib/view-pref'

// Leads: one page, two views (the Pipeline board and the list replaced /crm and the old All Leads page).
// - Board: the stages still being worked, one column each; Won and Lost are narrow drop targets with a count, so
//   closed Leads don't crowd it. Drag a card to move it; on a phone each card has a stage picker.
// - List: the same Leads as a table, Open by default, with Won / Lost / All tabs, search and filters.
// The view comes from the URL (?view=), else the saved choice, else the device (view-pref.ts).
const SHOW_TABS = [
  { id: 'open', label: 'Open' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
  { id: 'all', label: 'All' },
] as const
type Show = (typeof SHOW_TABS)[number]['id']
const parseShow = (v: unknown): Show | undefined => (SHOW_TABS.some((t) => t.id === v) ? (v as Show) : undefined)

export const Route = createFileRoute('/_staff/leads')({
  validateSearch: (s: Record<string, unknown>): { view?: BoardView; show?: Show } => ({ view: parseBoardView(s.view), show: parseShow(s.show) }),
  head: () => ({ meta: [{ title: 'Leads - Turner’s Decks CRM' }] }),
  beforeLoad: () => ({ defaultView: readDefaultView('leads') }),
  loader: async () => {
    const [leads, cron, customers, settings] = await Promise.all([listPipeline(), getCronHealth(), listCustomers(), getCompanySettings()])
    const referrers = customers.map((c) => ({ id: c.id, name: customerName(c) }))
    return { leads, referrers, timeZone: settings.timezone, cronStale: cron.stale, stuckJobs: cron.stuckJobs, stuckSubmissions: cron.stuckSubmissions }
  },
  component: LeadsPage,
})

type BoardLead = Awaited<ReturnType<typeof listPipeline>>[number]

function LeadsPage() {
  const { leads, referrers, timeZone, cronStale, stuckJobs, stuckSubmissions } = Route.useLoaderData()
  const { defaultView } = Route.useRouteContext()
  const search = Route.useSearch()
  const view = search.view ?? defaultView
  const show = search.show ?? 'open'
  const router = useRouter()
  const [moved, setMoved] = useState<Record<string, PipelineStage>>({})
  const [adding, setAdding] = useState(false)
  const [fields, setFields] = useLeadFields()

  const stageOf = (l: BoardLead) => moved[l.id] ?? l.stage

  async function move(id: string, stage: PipelineStage) {
    setMoved((m) => ({ ...m, [id]: stage }))
    try {
      await moveLeadStage({ data: { leadId: id, stage } })
      if (stage === 'won') toast.success('Won. Added to Contacts as a Customer, with a new Job.')
      await router.invalidate()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setMoved(({ [id]: _, ...rest }) => rest)
    }
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

  const openCount = leads.filter((l) => isOpenStage(stageOf(l))).length
  const counts: Record<Show, number> = {
    open: openCount,
    won: leads.filter((l) => stageOf(l) === 'won').length,
    lost: leads.filter((l) => stageOf(l) === 'lost').length,
    all: leads.length,
  }

  return (
    // Full-bleed: cancel <main>'s padding so the header rules run edge to edge; the board scrolls sideways inside.
    <div className="-m-4 flex min-h-0 flex-1 flex-col sm:-m-6">
      <div className="border-b">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight">Leads</h1>
            <ViewToggle page="leads" view={view} />
          </div>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden />
            New Lead
          </Button>
        </div>
      </div>
      <div className="flex min-h-11 items-center border-b px-4 py-1.5 sm:px-6">
        {view === 'board' ? (
          <p className="text-sm font-semibold tabular-nums">
            {openCount} open {openCount === 1 ? 'Lead' : 'Leads'}
          </p>
        ) : (
          <ShowTabs tabs={SHOW_TABS} value={show} counts={counts} />
        )}
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

      {view === 'board' ? (
        <LeadBoard leads={leads} stageOf={stageOf} move={move} counts={counts} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <LeadList
            rows={leads.filter((l) => show === 'all' || (show === 'open' ? isOpenStage(stageOf(l)) : stageOf(l) === show))}
            timeZone={timeZone}
            show={show}
          />
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Lead</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Source: manual entry</p>
          <form onSubmit={add} className="space-y-4">
            <LeadFieldsForm value={fields} onChange={setFields} referrers={referrers} />
            <Button className="w-full">Save Lead</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LeadBoard({
  leads,
  stageOf,
  move,
  counts,
}: {
  leads: BoardLead[]
  stageOf: (l: BoardLead) => PipelineStage
  move: (id: string, stage: PipelineStage) => Promise<void>
  counts: Record<Show, number>
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropStage, setDropStage] = useState<PipelineStage | null>(null)
  const endDrag = () => {
    setDragId(null)
    setDropStage(null)
  }
  const dropHandlers = (stage: PipelineStage) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropStage !== stage) setDropStage(stage)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      const id = dragId
      endDrag()
      if (id) void move(id, stage)
    },
  })

  return (
    <div className="flex min-h-[360px] flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
      {counts.all === 0 && <p className="mb-4 text-sm text-muted-foreground">No Leads yet.</p>}
      <div className="flex min-h-0 flex-1 snap-x snap-mandatory items-stretch gap-4 overflow-x-auto pb-2 xl:snap-none">
        {OPEN_STAGES.map((stage) => {
          const items = leads.filter((l) => stageOf(l) === stage)
          const styles = STAGE_STYLES[stage]
          return (
            <section
              key={stage}
              data-stage={stage}
              aria-label={STAGE_LABELS[stage]}
              {...dropHandlers(stage)}
              className={cn(
                'flex h-full min-h-0 w-[85vw] max-w-[300px] shrink-0 snap-start flex-col overflow-hidden rounded-t-2xl border-x border-t bg-background sm:w-[280px] xl:w-auto xl:min-w-[240px] xl:max-w-none xl:flex-1',
                dropStage === stage && 'border-primary/50 bg-primary/5',
              )}
            >
              <div className="sticky top-0 z-10 flex min-h-14 flex-col justify-center gap-0.5 rounded-t-2xl border-b bg-muted/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={cn('size-2 shrink-0 rounded-full', styles.dot)} aria-hidden />
                  <h2 className="text-sm font-semibold">{STAGE_LABELS[stage]}</h2>
                  <span className="rounded-full bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">{items.length}</span>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {items.length === 0 && <div className="min-h-28 rounded-xl border border-dashed border-border/70" aria-hidden />}
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
                        {channelLabel(l.channel)} · {reportedSource(l)}
                      </p>
                      <h3 className="mt-1 line-clamp-2 text-sm font-semibold">
                        <Link to="/leads/$id" params={{ id: l.id }} className="hover:underline">
                          {leadName(l)}
                        </Link>
                      </h3>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{[l.street, l.city].filter(Boolean).join(', ') || l.email || l.phone}</p>
                      {l.needsReview && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="destructive">Needs review</Badge>
                        </div>
                      )}
                      <label className="mt-3 block xl:hidden">
                        <span className="sr-only">Pipeline stage</span>
                        <select
                          value={stageOf(l)}
                          onChange={(e) => void move(l.id, e.target.value as PipelineStage)}
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s}>
                              {STAGE_LABELS[s]}
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

        {/* Won and Lost: drop targets with a count, not columns of cards. */}
        <div className="flex w-[85vw] max-w-[300px] shrink-0 snap-start flex-col gap-3 sm:w-[170px] xl:w-[170px]">
          {CLOSED_STAGES.map((stage) => (
            <section
              key={stage}
              data-stage={stage}
              aria-label={STAGE_LABELS[stage]}
              {...dropHandlers(stage)}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-4 text-center',
                dropStage === stage ? 'border-primary/60 bg-primary/5' : 'border-border/70',
              )}
            >
              <span className={cn('size-2 rounded-full', STAGE_STYLES[stage].dot)} aria-hidden />
              <h2 className="text-sm font-semibold">{STAGE_LABELS[stage]}</h2>
              <p className="text-2xl font-semibold tabular-nums">{counts[stage]}</p>
              <p className="text-[11px] text-muted-foreground">Drop a Lead here</p>
              <Link to="/leads" search={{ view: 'list', show: stage }} className="mt-1 text-xs font-medium underline underline-offset-2">
                See the list
              </Link>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

const LEADS_CAP = 2000

function LeadList({ rows, timeZone, show }: { rows: BoardLead[]; timeZone: string; show: Show }) {
  const channels = [...new Set(rows.map((l) => channelLabel(l.channel)))].sort()
  const foundVia = [...new Set(rows.map((l) => reportedSource(l)))].sort()
  const towns = [...new Set(rows.map((l) => l.city).filter((v): v is string => !!v))].sort()
  const columns: ColumnDef<BoardLead, unknown>[] = [
    {
      id: 'name',
      accessorFn: (l) => leadName(l),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => (
        <Link to="/leads/$id" params={{ id: row.original.id }} className="font-medium hover:underline">
          {leadName(row.original) || 'Unnamed Lead'}
        </Link>
      ),
      meta: { label: 'Name', mobile: 'title' },
    },
    // Nullable fields read as '' so they always stay in the global search.
    { id: 'phone', accessorFn: (l) => `${l.phone ?? ''} ${l.phoneE164 ?? ''}`, header: 'Phone', cell: ({ row }) => <span className="text-nowrap">{row.original.phone}</span> },
    { id: 'email', accessorFn: (l) => l.email ?? '', header: 'Email', cell: ({ row }) => <span className="break-all">{row.original.email}</span> },
    { id: 'city', accessorFn: (l) => l.city ?? '', header: 'Town' },
    {
      accessorKey: 'stage',
      header: 'Stage',
      cell: ({ row }) => <Badge variant={row.original.stage === 'won' ? 'success' : 'secondary'}>{STAGE_LABELS[row.original.stage]}</Badge>,
      enableGlobalFilter: false,
    },
    { id: 'channel', accessorFn: (l) => channelLabel(l.channel), header: 'Came in by', enableGlobalFilter: false },
    { id: 'foundVia', accessorFn: (l) => reportedSource(l), header: 'Found us via', enableGlobalFilter: false },
    {
      id: 'createdAt',
      accessorFn: (l) => new Date(l.createdAt).getTime(),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Received" />,
      cell: ({ row }) => <span className="text-nowrap">{formatWhen(row.original.createdAt, timeZone)}</span>,
      enableGlobalFilter: false,
      meta: { label: 'Received' },
    },
  ]
  const stageOptions = (show === 'open' ? [...OPEN_STAGES] : show === 'all' ? STAGES : []).map((s) => ({ value: s, label: STAGE_LABELS[s] }))
  return (
    <DataTable
      key={show}
      label="Leads"
      columns={columns}
      data={rows}
      getRowId={(l) => l.id}
      rowProps={(l) => ({ 'data-stage': l.stage })}
      search={{ placeholder: 'Search name, phone, email or town' }}
      facets={[
        ...(stageOptions.length > 1 ? [{ columnId: 'stage', title: 'Stage', options: stageOptions }] : []),
        { columnId: 'channel', title: 'Came in by', options: channels.map((s) => ({ value: s, label: s })) },
        { columnId: 'foundVia', title: 'Found us via', options: foundVia.map((s) => ({ value: s, label: s })) },
        ...(towns.length ? [{ columnId: 'city', title: 'Town', options: towns.map((t) => ({ value: t, label: t })) }] : []),
      ]}
      empty={show === 'open' ? 'No open Leads.' : 'No Leads here.'}
      cap={LEADS_CAP}
    />
  )
}
