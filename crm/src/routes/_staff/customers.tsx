import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, UserRoundCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { CustomerFields, type CustomerDraft, customerInput } from '#/components/CustomerForms'
import { DataTable, DataTableColumnHeader } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '#/components/ui/dialog'
import { customerName } from '#/lib/customer-vocab'
import { createCustomer, listCustomers } from '#/lib/customers.functions'
import { formatDay } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'
import { getCompanySettings } from '#/lib/settings.functions'

// Customers (GLOSSARY): everyone a won Lead became, plus Customers added by hand or imported. Same table kit as
// All Leads (leads.tsx), client mode over the newest 500.
export const Route = createFileRoute('/_staff/customers')({
  head: () => ({ meta: [{ title: 'Customers - Turner’s Decks CRM' }] }),
  loader: async () => {
    const [rows, settings] = await Promise.all([listCustomers(), getCompanySettings()])
    return { rows, timeZone: settings.timezone }
  },
  component: CustomersPage,
})

/** listCustomers' default row limit (customers.server.ts). */
const CUSTOMERS_CAP = 500

type CustomerRow = Awaited<ReturnType<typeof listCustomers>>[number]

const EMPTY: CustomerDraft = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  street: '',
  city: '',
  state: 'PA',
  zip: '',
  howFound: '',
  customerSince: '',
  referredById: '',
  okToContact: true,
  reviewLeft: false,
  notes: '',
}

function AddCustomer({ referrers }: { referrers: { id: string; name: string }[] }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CustomerDraft>(EMPTY)
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const created = await createCustomer({ data: customerInput(draft) })
      toast.success('Customer added')
      setOpen(false)
      setDraft(EMPTY)
      await navigate({ to: '/customers/$id', params: { id: created.id } })
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          Add Customer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={save}>
          <DialogHeader className="mb-4">
            <DialogTitle>Add a Customer</DialogTitle>
            <DialogDescription>For past Customers. A Lead that is won becomes a Customer by itself.</DialogDescription>
          </DialogHeader>
          <fieldset disabled={saving} className="min-w-0">
            <CustomerFields value={draft} onChange={setDraft} referrers={referrers} />
          </fieldset>
          <DialogFooter className="mt-6">
            <Button disabled={saving}>Add Customer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CustomersPage() {
  const { rows, timeZone } = Route.useLoaderData()
  const howFound = [...new Set(rows.map((c) => c.howFound).filter((v): v is string => !!v))].sort()
  const referrers = rows.map((c) => ({ id: c.id, name: customerName(c) }))

  const columns: ColumnDef<CustomerRow, unknown>[] = [
    {
      id: 'name',
      accessorFn: customerName,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => (
        <Link to="/customers/$id" params={{ id: row.original.id }} className="font-medium hover:underline">
          {customerName(row.original)}
        </Link>
      ),
      meta: { label: 'Name', mobile: 'title' },
    },
    { id: 'phone', accessorFn: (c) => c.phone ?? '', header: 'Phone', cell: ({ row }) => <span className="text-nowrap">{row.original.phone}</span> },
    { id: 'email', accessorFn: (c) => c.email ?? '', header: 'Email', cell: ({ row }) => <span className="break-all">{row.original.email}</span> },
    { id: 'city', accessorFn: (c) => c.city ?? '', header: 'Town' },
    { id: 'howFound', accessorFn: (c) => c.howFound ?? '', header: 'How they found us', enableGlobalFilter: false },
    {
      accessorKey: 'jobsDone',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Jobs done" />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.jobsDone}</span>,
      enableGlobalFilter: false,
      meta: { label: 'Jobs done' },
    },
    {
      id: 'customerSince',
      accessorFn: (c) => (c.customerSince ? new Date(c.customerSince).getTime() : 0),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Customer since" />,
      cell: ({ row }) => <span className="text-nowrap">{row.original.customerSince ? formatDay(row.original.customerSince, timeZone) : ''}</span>,
      enableGlobalFilter: false,
      meta: { label: 'Customer since' },
    },
  ]

  return (
    <div>
      <PageHeader title="Customers" actions={<AddCustomer referrers={referrers} />} />
      {rows.length === 0 ? (
        <EmptyState icon={UserRoundCheck} title="No Customers yet." description="A Lead moved to Won shows up here." bordered />
      ) : (
        <DataTable
          label="Customers"
          columns={columns}
          data={rows}
          getRowId={(c) => c.id}
          search={{ placeholder: 'Search name, phone, email or town' }}
          facets={howFound.length ? [{ columnId: 'howFound', title: 'How they found us', options: howFound.map((v) => ({ value: v, label: v })) }] : []}
          cap={CUSTOMERS_CAP}
        />
      )}
    </div>
  )
}
