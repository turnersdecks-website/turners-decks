import { Link, createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Hammer } from 'lucide-react'
import { DataTable, DataTableColumnHeader } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { PageHeader, StatCard, StatGrid } from '#/components/page'
import { JOB_STATUSES, JOB_STATUS_LABELS, JOB_STATUS_STYLES, customerName, formatMoney, jobMetrics } from '#/lib/customer-vocab'
import { listJobs } from '#/lib/customers.functions'
import { cn } from '#/lib/utils'

// Jobs (GLOSSARY): every project, newest first, with the Airtable tracker's totals (lead-tracker-spec.md > Interface >
// Jobs): square footage, quoted price and gross margin summed, labor hours per 100 sq ft and margin % averaged over
// the Jobs that have them.
export const Route = createFileRoute('/_staff/jobs')({
  head: () => ({ meta: [{ title: 'Jobs - Turner’s Decks CRM' }] }),
  loader: () => listJobs(),
  component: JobsPage,
})

const JOBS_CAP = 500

type JobRow = Awaited<ReturnType<typeof listJobs>>[number]

const average = (values: (number | null)[]) => {
  const xs = values.filter((v): v is number => v !== null)
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null
}

function JobsPage() {
  const rows = Route.useLoaderData()
  const metrics = rows.map((r) => jobMetrics(r.job))
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0)
  const totalSqft = sum(rows.map((r) => r.job.squareFootage))
  const totalQuoted = sum(rows.map((r) => r.job.quotedPriceCents))
  const avgLabor = average(metrics.map((m) => m.laborHoursPer100Sqft))
  const avgMargin = average(metrics.map((m) => m.grossMarginPct))

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
    <div>
      <PageHeader title="Jobs" description="A Job is added when a Lead is won, or from a Customer's page." />
      {rows.length > 0 && (
        <StatGrid>
          <StatCard label="Square footage" value={totalSqft.toLocaleString('en-US')} hint="All Jobs listed" />
          <StatCard label="Quoted" value={formatMoney(totalQuoted) || '$0'} hint="All Jobs listed" />
          <StatCard label="Labor hours per 100 sq ft" value={avgLabor ?? '–'} hint="Average of Jobs with hours and size" />
          <StatCard label="Gross margin" value={avgMargin === null ? '–' : `${avgMargin}%`} hint="Average of Jobs with costs filled in" />
        </StatGrid>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={Hammer} title="No Jobs yet." description="Move a Lead to Won, or add a Job from a Customer's page." bordered />
      ) : (
        <DataTable
          label="Jobs"
          columns={columns}
          data={rows}
          getRowId={(r) => r.job.id}
          rowProps={(r) => ({ 'data-status': r.job.status })}
          search={{ placeholder: 'Search Job, Customer or town' }}
          facets={[{ columnId: 'status', title: 'Status', options: JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] })) }]}
          cap={JOBS_CAP}
        />
      )}
    </div>
  )
}
