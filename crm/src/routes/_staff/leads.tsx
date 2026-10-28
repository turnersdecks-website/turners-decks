import { Link, createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Users } from 'lucide-react'
import { DataTable, DataTableColumnHeader } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page'
import { Badge } from '#/components/ui/badge'
import { formatWhen } from '#/lib/dates'
import { listLeads } from '#/lib/leads.functions'
import { STAGES, STAGE_LABELS } from '#/lib/pipeline'
import { getCompanySettings } from '#/lib/settings.functions'

// All Leads (plan 007 K3), kit original/(users) table over listLeads' newest 200 (client mode, plan 007 decision 11).
export const Route = createFileRoute('/_staff/leads')({
  head: () => ({ meta: [{ title: 'Leads - Turner’s Decks CRM' }] }),
  loader: async () => {
    const [rows, settings] = await Promise.all([listLeads(), getCompanySettings()])
    return { rows, timeZone: settings.timezone }
  },
  component: LeadsPage,
})

/** listLeads' row limit (leads.functions.ts). */
const LEADS_CAP = 200

type LeadRow = Awaited<ReturnType<typeof listLeads>>[number]

const fullName = (l: LeadRow) => [l.firstName, l.lastName].filter(Boolean).join(' ')

function LeadsPage() {
  const { rows, timeZone } = Route.useLoaderData()
  const sources = [...new Set(rows.map((l) => l.source))].sort()

  const columns: ColumnDef<LeadRow, unknown>[] = [
    {
      id: 'name',
      accessorFn: fullName,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => (
        <Link to="/leads/$id" params={{ id: row.original.id }} className="font-medium hover:underline">
          {fullName(row.original) || 'Unnamed Lead'}
        </Link>
      ),
      meta: { label: 'Name', mobile: 'title' },
    },
    // Nullable fields read as '' so they always stay in the global search.
    { id: 'phoneE164', accessorFn: (l) => l.phoneE164 ?? '', header: 'Phone', cell: ({ row }) => <span className="text-nowrap">{row.original.phoneE164}</span> },
    { id: 'email', accessorFn: (l) => l.email ?? '', header: 'Email', cell: ({ row }) => <span className="break-all">{row.original.email}</span> },
    {
      accessorKey: 'stage',
      header: 'Stage',
      cell: ({ row }) => <Badge variant={row.original.stage === 'won' ? 'success' : 'secondary'}>{STAGE_LABELS[row.original.stage]}</Badge>,
      enableGlobalFilter: false,
    },
    { accessorKey: 'source', header: 'Source', enableGlobalFilter: false },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Received" />,
      cell: ({ row }) => <span className="text-nowrap">{formatWhen(row.original.createdAt, timeZone)}</span>,
      meta: { label: 'Received' },
    },
  ]

  return (
    <div>
      <PageHeader title="Leads" />
      {rows.length === 0 ? (
        <EmptyState icon={Users} title="No Leads yet." bordered />
      ) : (
        <DataTable
          label="Leads"
          columns={columns}
          data={rows}
          getRowId={(l) => l.id}
          rowProps={(l) => ({ 'data-stage': l.stage })}
          search={{ placeholder: 'Search name, phone or email' }}
          facets={[
            { columnId: 'stage', title: 'Stage', options: STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] })) },
            { columnId: 'source', title: 'Source', options: sources.map((s) => ({ value: s, label: s })) },
          ]}
          cap={LEADS_CAP}
        />
      )}
    </div>
  )
}
