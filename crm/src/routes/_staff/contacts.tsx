import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Check, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { CustomerFields, type CustomerDraft, customerInput } from '#/components/CustomerForms'
import { DataTable, DataTableColumnHeader } from '#/components/data-table'
import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '#/components/ui/dialog'
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, type ContactRow } from '#/lib/contact-vocab'
import { createCustomer, listContacts } from '#/lib/customers.functions'
import { formatDay } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'
import { getCompanySettings } from '#/lib/settings.functions'

// Contacts (GLOSSARY Contact): every person in one list, for looking someone up and for marketing lists. Customers,
// plus Leads that have no Customer; the type is worked out (contacts.server.ts), never picked. A Customer opens their
// Customer page (their Leads and Jobs together); a Lead with no Customer opens the Lead.
// Marketing: "OK to market" is off for Do not contact Leads and Customers not OK to contact (lost to a competitor, got
// a deck elsewhere); "Texts OK" is the number's latest text consent. A campaign list starts from those two filters.
export const Route = createFileRoute('/_staff/contacts')({
  head: () => ({ meta: [{ title: 'Contacts - Turner’s Decks CRM' }] }),
  loader: async () => {
    const [rows, settings] = await Promise.all([listContacts(), getCompanySettings()])
    return { rows, timeZone: settings.timezone }
  },
  component: ContactsPage,
})

const CONTACTS_CAP = 4000
const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]
const TYPE_STYLES: Record<ContactRow['type'], 'success' | 'secondary' | 'outline' | 'default'> = {
  customer: 'success',
  customer_open_lead: 'default',
  open_lead: 'secondary',
  closed_lead: 'outline',
}

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
  referredByName: '',
  clientType: 'residential',
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
          Add past Customer
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

function ContactsPage() {
  const { rows, timeZone } = Route.useLoaderData()
  const origins = [...new Set(rows.map((c) => c.origin).filter((v): v is string => !!v))].sort()
  const towns = [...new Set(rows.map((c) => c.town).filter((v): v is string => !!v))].sort()
  const referrers = rows.filter((c) => c.kind === 'customer').map((c) => ({ id: c.id, name: c.name }))

  const columns: ColumnDef<ContactRow, unknown>[] = [
    {
      id: 'name',
      accessorFn: (c) => c.name,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) =>
        row.original.kind === 'customer' ? (
          <Link to="/customers/$id" params={{ id: row.original.id }} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ) : (
          <Link to="/leads/$id" params={{ id: row.original.id }} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      meta: { label: 'Name', mobile: 'title' },
    },
    {
      id: 'type',
      accessorFn: (c) => c.type,
      header: 'Type',
      cell: ({ row }) => <Badge variant={TYPE_STYLES[row.original.type]}>{CONTACT_TYPE_LABELS[row.original.type]}</Badge>,
      enableGlobalFilter: false,
    },
    { id: 'phone', accessorFn: (c) => c.phone ?? '', header: 'Phone', cell: ({ row }) => <span className="text-nowrap">{row.original.phone}</span> },
    { id: 'email', accessorFn: (c) => c.email ?? '', header: 'Email', cell: ({ row }) => <span className="break-all">{row.original.email}</span> },
    { id: 'town', accessorFn: (c) => c.town ?? '', header: 'Town' },
    { id: 'origin', accessorFn: (c) => c.origin ?? '', header: 'How they came in', enableGlobalFilter: false },
    {
      id: 'marketable',
      accessorFn: (c) => (c.marketable ? 'yes' : 'no'),
      header: 'OK to market',
      cell: ({ row }) => (row.original.marketable ? <Check className="size-4 text-emerald-600" aria-label="Yes" /> : <span className="text-xs text-muted-foreground">Do not contact</span>),
      enableGlobalFilter: false,
    },
    {
      id: 'textOk',
      accessorFn: (c) => (c.textOk ? 'yes' : 'no'),
      header: 'Texts OK',
      cell: ({ row }) => (row.original.textOk ? <Check className="size-4 text-emerald-600" aria-label="Yes" /> : <span className="sr-only">No</span>),
      enableGlobalFilter: false,
    },
    {
      id: 'lastAt',
      accessorFn: (c) => c.lastAt ?? 0,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Latest" />,
      cell: ({ row }) => <span className="text-nowrap">{row.original.lastAt ? formatDay(new Date(row.original.lastAt), timeZone) : ''}</span>,
      enableGlobalFilter: false,
      meta: { label: 'Latest' },
    },
  ]

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Everyone: Customers, and Leads who have not bought. Filter by type, and by OK to market and Texts OK for a campaign list."
        actions={<AddCustomer referrers={referrers} />}
      />
      {rows.length === 0 ? (
        <EmptyState icon={Users} title="No Contacts yet." description="Website Leads, texts and calls to the Quo number, and won Leads show up here." bordered />
      ) : (
        <DataTable
          label="Contacts"
          columns={columns}
          data={rows}
          getRowId={(c) => c.key}
          rowProps={(c) => ({ 'data-type': c.type })}
          search={{ placeholder: 'Search name, phone, email or town' }}
          facets={[
            { columnId: 'type', title: 'Type', options: CONTACT_TYPES.map((t) => ({ value: t, label: CONTACT_TYPE_LABELS[t] })) },
            { columnId: 'marketable', title: 'OK to market', options: YES_NO },
            { columnId: 'textOk', title: 'Texts OK', options: YES_NO },
            ...(towns.length ? [{ columnId: 'town', title: 'Town', options: towns.map((t) => ({ value: t, label: t })) }] : []),
            ...(origins.length ? [{ columnId: 'origin', title: 'How they came in', options: origins.map((v) => ({ value: v, label: v })) }] : []),
          ]}
          cap={CONTACTS_CAP}
        />
      )}
    </div>
  )
}
