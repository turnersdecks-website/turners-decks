import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { ChevronRight, Inbox, RotateCcw, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { DataTable } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page'
import { Badge, type BadgeProps } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { formatWhen } from '#/lib/dates'
import { getCompanySettings } from '#/lib/settings.functions'
import { type SubmissionsView, listSubmissions, replaySubmission } from '#/lib/submissions.functions'
import { cn } from '#/lib/utils'

// Admin Submissions screen (PLAN.md > Intake contract): Form submissions with their Intake state, paged.
// Opens on the ones needing attention (rejected, failed, stuck) so none drops out of reach; any but a
// processed one can be replayed. Plan 007 K3: kit table in manual mode; the server keeps paging with the `Older`
// cursor link, and the view stays in `?view=`.
export const Route = createFileRoute('/_staff/submissions')({
  validateSearch: (search: Record<string, unknown>): { view?: SubmissionsView; before?: string } => ({
    view: search.view === 'all' ? 'all' : undefined,
    before: typeof search.before === 'string' ? search.before : undefined,
  }),
  loaderDeps: ({ search }) => ({ view: search.view ?? 'unresolved', before: search.before }),
  loader: async ({ deps }) => {
    const [settings, page] = await Promise.all([
      getCompanySettings(),
      listSubmissions({ data: deps }).catch((error: unknown) => {
        if (error instanceof Response && error.status === 403) return null
        throw error
      }),
    ])
    return page
      ? { forbidden: false as const, timeZone: settings.timezone, ...page }
      : { forbidden: true as const, timeZone: settings.timezone, rows: [], nextBefore: null }
  },
  component: SubmissionsPage,
})

type Submission = Awaited<ReturnType<typeof listSubmissions>>['rows'][number]

const STATE_VARIANTS: Record<string, BadgeProps['variant']> = { processed: 'success', processing: 'secondary' }

const tabClass = (active: boolean) =>
  cn(
    'inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-all',
    active ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
  )

function SubmissionsPage() {
  const { forbidden, rows, nextBefore, timeZone } = Route.useLoaderData()
  const { view } = Route.useLoaderDeps()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  if (forbidden) {
    return (
      <div>
        <PageHeader title="Submissions" />
        <EmptyState icon={ShieldAlert} title="Only admins can see Form submissions." bordered />
      </div>
    )
  }

  async function replay(id: string) {
    setBusy(id)
    setMessage(null)
    try {
      const result = await replaySubmission({ data: { submissionId: id } })
      setMessage(
        result.leadId
          ? 'Replayed: the submission is on its Lead.'
          : result.pending
            ? 'Still being processed. Try again in a minute.'
            : `Replayed, still not a Lead: ${result.error ?? 'rejected'}`,
      )
      await router.invalidate()
    } catch {
      setMessage('Replay failed. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const replayButton = (s: Submission) =>
    s.state !== 'processed' && (
      <Button type="button" variant="outline" size="sm" className="h-8" disabled={busy === s.id} onClick={() => replay(s.id)}>
        <RotateCcw />
        {busy === s.id ? 'Replaying…' : 'Replay'}
      </Button>
    )

  const columns: ColumnDef<Submission, unknown>[] = [
    {
      accessorKey: 'receivedAt',
      header: 'Received',
      cell: ({ row }) => <span className="text-nowrap">{formatWhen(row.original.receivedAt, timeZone)}</span>,
    },
    { accessorKey: 'source', header: 'Form' },
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span>, meta: { mobile: 'title' } },
    { accessorKey: 'phone', header: 'Phone', cell: ({ row }) => <span className="text-nowrap">{row.original.phone}</span> },
    { accessorKey: 'email', header: 'Email', cell: ({ row }) => <span className="break-all">{row.original.email}</span> },
    {
      accessorKey: 'state',
      header: 'State',
      cell: ({ row }) => <Badge variant={STATE_VARIANTS[row.original.state] ?? 'destructive'}>{row.original.state}</Badge>,
    },
    {
      accessorKey: 'error',
      header: 'Error',
      cell: ({ row }) => <span className="block max-w-xs text-xs break-words whitespace-normal">{row.original.error}</span>,
    },
    { accessorKey: 'attempts', header: 'Attempts', cell: ({ row }) => <span className="tabular-nums">{row.original.attempts}</span> },
    {
      id: 'replay',
      header: () => <span className="sr-only">Replay</span>,
      cell: ({ row }) => <div className="flex justify-end">{replayButton(row.original)}</div>,
      enableHiding: false,
      meta: { label: 'Replay' },
    },
  ]

  return (
    <div>
      <PageHeader title="Submissions" />
      <nav aria-label="Submissions view" className="bg-muted text-muted-foreground mb-4 inline-flex h-9 items-center rounded-lg p-1">
        <Link to="/submissions" className={tabClass(view === 'unresolved')} aria-current={view === 'unresolved' ? 'page' : undefined}>
          Needs attention
        </Link>
        <Link to="/submissions" search={{ view: 'all' }} className={tabClass(view === 'all')} aria-current={view === 'all' ? 'page' : undefined}>
          All
        </Link>
      </nav>
      {message && (
        <p className="bg-muted mb-4 rounded-md px-3 py-2 text-sm" role="status">
          {message}
        </p>
      )}
      {rows.length === 0 && !nextBefore ? (
        <EmptyState icon={Inbox} title={view === 'unresolved' ? 'Nothing needs attention.' : 'No Form submissions yet.'} bordered />
      ) : (
        <DataTable
          mode="manual"
          label="Form submissions"
          columns={columns}
          data={rows}
          getRowId={(s) => s.id}
          mobileCard={(s) => (
            <article className="bg-card rounded-lg border p-4" data-slot="data-table-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {s.source} · {formatWhen(s.receivedAt, timeZone)}
                  </p>
                </div>
                <Badge variant={STATE_VARIANTS[s.state] ?? 'destructive'}>{s.state}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Phone</dt>
                  <dd>{s.phone}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Email</dt>
                  <dd className="break-all">{s.email}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Attempts</dt>
                  <dd>{s.attempts}</dd>
                </div>
                {s.error && (
                  <div className="col-span-2 min-w-0">
                    <dt className="text-muted-foreground text-xs">Error</dt>
                    <dd className="break-words">{s.error}</dd>
                  </div>
                )}
              </dl>
              {s.state !== 'processed' && <div className="mt-3">{replayButton(s)}</div>}
            </article>
          )}
          footer={
            nextBefore && (
              <Button asChild variant="outline" size="sm">
                <Link to="/submissions" search={{ view: view === 'all' ? 'all' : undefined, before: nextBefore }}>
                  Older
                  <ChevronRight />
                </Link>
              </Button>
            )
          }
        />
      )}
    </div>
  )
}
