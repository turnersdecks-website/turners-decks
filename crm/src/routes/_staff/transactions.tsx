import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Receipt } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ShowTabs } from '#/components/board-views'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { formatMoney } from '#/lib/customer-vocab'
import { errorMessage } from '#/lib/errors'
import { QBO_ENTITY_LABELS, type QboEntity } from '#/lib/qbo-vocab'
import { assignQboTransactions, listJobChoices, listQboTransactions } from '#/lib/qbo.functions'
import { cn } from '#/lib/utils'

// Transactions (docs/adr/0006-quickbooks-sync.md): what the nightly sync copied from QuickBooks. Staff sort each one
// onto a Job or as overhead; Claude can do the same through the CRM connector. Invoices and payments that name a
// Customer are put on their Job automatically; costs show a suggested Job to confirm. QuickBooks is never changed.
const TABS = [
  { id: 'unassigned', label: 'To sort' },
  { id: 'job', label: 'On a Job' },
  { id: 'overhead', label: 'Overhead' },
  { id: 'all', label: 'All' },
] as const
type Show = (typeof TABS)[number]['id']

export const Route = createFileRoute('/_staff/transactions')({
  validateSearch: (s: Record<string, unknown>): { show?: Show; q?: string } => ({
    show: TABS.some((t) => t.id === s.show) ? (s.show as Show) : undefined,
    q: typeof s.q === 'string' && s.q ? s.q.slice(0, 100) : undefined,
  }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  head: () => ({ meta: [{ title: 'Transactions - Turner’s Decks CRM' }] }),
  loader: async ({ deps }) => {
    const [rows, jobs] = await Promise.all([listQboTransactions({ data: { show: 'all', search: deps.q ?? null, limit: 2000 } }), listJobChoices()])
    return { rows, jobs }
  },
  component: TransactionsPage,
})

type Row = Awaited<ReturnType<typeof listQboTransactions>>[number]
type JobChoice = Awaited<ReturnType<typeof listJobChoices>>[number]

const jobLabel = (j: JobChoice) => `${[j.first, j.last].filter(Boolean).join(' ') || 'Customer'} · ${j.name}`
const signed = (r: Row) => (r.kind === 'cost' || r.kind === 'revenue_credit' ? -r.amountCents : r.amountCents)

function TransactionsPage() {
  const { rows, jobs } = Route.useLoaderData()
  const search = Route.useSearch()
  const show = search.show ?? 'unassigned'
  const navigate = useNavigate()
  const [q, setQ] = useState(search.q ?? '')
  const counts: Record<Show, number> = {
    unassigned: rows.filter((r) => !r.assignment).length,
    job: rows.filter((r) => r.assignment === 'job').length,
    overhead: rows.filter((r) => r.assignment === 'overhead').length,
    all: rows.length,
  }
  const shown = rows.filter((r) => (show === 'all' ? true : show === 'unassigned' ? !r.assignment : r.assignment === show))
  const jobsById = new Map(jobs.map((j) => [j.id, j]))

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="From QuickBooks, synced every night. Put each one on a Job or mark it overhead; nothing changes in QuickBooks."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ShowTabs tabs={TABS} value={show} counts={counts} />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void navigate({ to: '.', search: (s: Record<string, unknown>) => ({ ...s, q: q || undefined }) as never })
          }}
        >
          <Input aria-label="Search transactions" placeholder="Search vendor, memo or account" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        </form>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No transactions yet." description="An admin connects QuickBooks in Settings; the first sync brings in everything since January 2025." bordered />
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{show === 'unassigned' ? 'Everything is sorted.' : 'Nothing here.'}</p>
      ) : (
        <Card className="overflow-x-auto shadow-xs">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Vendor / customer</th>
                <th className="px-3 py-2 text-left font-medium">Account · memo</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Job</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <TxnRow key={r.id} r={r} jobs={jobs} job={r.jobId ? jobsById.get(r.jobId) : undefined} suggested={r.suggestedJobId ? jobsById.get(r.suggestedJobId) : undefined} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function TxnRow({ r, jobs, job, suggested }: { r: Row; jobs: JobChoice[]; job?: JobChoice; suggested?: JobChoice }) {
  const router = useRouter()
  const [pick, setPick] = useState(suggested?.id ?? '')
  const [busy, setBusy] = useState(false)
  const amount = signed(r)

  async function assign(to: 'job' | 'overhead' | 'unassigned', jobId?: string) {
    setBusy(true)
    try {
      await assignQboTransactions({ data: { ids: [r.id], to, jobId: jobId ?? null } })
      await router.invalidate()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr data-txn={r.id} className="border-b align-top last:border-0">
      <td className="px-3 py-2 text-nowrap tabular-nums">{r.txnDate}</td>
      <td className="px-3 py-2 text-nowrap">{QBO_ENTITY_LABELS[r.entity as QboEntity] ?? r.entity}</td>
      <td className="px-3 py-2">{r.partyName}</td>
      <td className="max-w-[280px] px-3 py-2">
        <span className="block truncate">{r.account}</span>
        {r.memo && <span className="block truncate text-xs text-muted-foreground">{r.memo}</span>}
      </td>
      <td className={cn('px-3 py-2 text-right text-nowrap tabular-nums', amount < 0 ? 'text-foreground' : 'text-success')}>
        {amount < 0 ? '−' : '+'}
        {formatMoney(Math.abs(amount))}
      </td>
      <td className="px-3 py-2">
        {r.assignment === 'job' && job ? (
          <span className="flex items-center gap-2">
            <Link to="/jobs/$id" params={{ id: job.id }} className="hover:underline">
              {jobLabel(job)}
            </Link>
            {r.assignedBy === 'auto' && <span className="text-[11px] text-muted-foreground">auto</span>}
            <button type="button" className="text-xs text-muted-foreground underline" disabled={busy} onClick={() => assign('unassigned')}>
              Change
            </button>
          </span>
        ) : r.assignment === 'overhead' ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            Overhead
            <button type="button" className="text-xs underline" disabled={busy} onClick={() => assign('unassigned')}>
              Change
            </button>
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="Job"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-8 max-w-[220px] rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">Pick a Job…</option>
              {suggested && <option value={suggested.id}>Suggested: {jobLabel(suggested)}</option>}
              {jobs
                .filter((j) => j.id !== suggested?.id)
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {jobLabel(j)}
                  </option>
                ))}
            </select>
            <Button size="sm" className="h-8" disabled={busy || !pick} onClick={() => assign('job', pick)}>
              Put on Job
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => assign('overhead')}>
              Overhead
            </Button>
          </div>
        )}
      </td>
    </tr>
  )
}
