import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Hammer, Plus, SearchX, UserRoundCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { CustomerFields, type CustomerDraft, customerDraftFrom, customerInput } from '#/components/CustomerForms'
import { EmptyState } from '#/components/empty-state'
import { FormField } from '#/components/LeadForm'
import { Badge } from '#/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { JOB_STATUS_LABELS, JOB_STATUS_STYLES, customerName, formatMoney } from '#/lib/customer-vocab'
import { createJob, getCustomer, listCustomers, updateCustomer } from '#/lib/customers.functions'
import { formatDay, formatWhen } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'
import { STAGE_LABELS, leadName } from '#/lib/pipeline'
import { getCompanySettings } from '#/lib/settings.functions'
import { cn } from '#/lib/utils'

// A Customer (GLOSSARY): their details on the left, their Jobs, Leads and referrals on the right, in the Lead page's
// card-and-rail layout (leads_.$id.tsx).

async function loadCustomerPage(customerId: string) {
  const notFoundAsNull = (error: unknown) => {
    if (error instanceof Response && error.status === 404) return null
    throw error
  }
  const [found, all, settings] = await Promise.all([
    getCustomer({ data: { customerId } }).catch(notFoundAsNull),
    listCustomers(),
    getCompanySettings(),
  ])
  return { found, all, timeZone: settings.timezone }
}

export const Route = createFileRoute('/_staff/customers_/$id')({
  head: () => ({ meta: [{ title: 'Customer - Turner’s Decks CRM' }] }),
  loader: ({ params }) => loadCustomerPage(params.id),
  component: CustomerDetail,
})

function RailSection({ title, icon: Icon, action, children }: { title: string; icon: typeof Hammer; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2 border-b px-4 py-4 last:border-b-0 sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

type Found = NonNullable<Awaited<ReturnType<typeof loadCustomerPage>>['found']>

function DetailsCard({ customer, referrers, timeZone, refresh }: { customer: Found['customer']; referrers: { id: string; name: string }[]; timeZone: string; refresh: () => Promise<void> }) {
  const [draft, setDraft] = useState<CustomerDraft>(() => customerDraftFrom(customer, timeZone))
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateCustomer({ data: { customerId: customer.id, ...customerInput(draft) } })
      toast.success('Saved')
      await refresh()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <UserRoundCheck className="size-4" aria-hidden />
        </span>
        <h2 className="text-sm font-semibold">Customer</h2>
      </div>
      <fieldset disabled={saving} className="min-w-0">
        <div className="p-4 sm:p-5">
          <CustomerFields value={draft} onChange={setDraft} referrers={referrers} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3">
          <p className="text-xs text-muted-foreground">Last updated {formatWhen(customer.updatedAt, timeZone)}</p>
          <Button size="sm">Save changes</Button>
        </div>
      </fieldset>
    </form>
  )
}

function AddJob({ customerId, city }: { customerId: string; city: string | null }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const job = await createJob({ data: { customerId, name, city: city ?? '' } })
      setOpen(false)
      await navigate({ to: '/jobs/$id', params: { id: job.id } })
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2">
          <Plus />
          Add Job
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save}>
          <DialogHeader className="mb-4">
            <DialogTitle>Add a Job</DialogTitle>
          </DialogHeader>
          <FormField id="new-job-name" label="Job name">
            <Input id="new-job-name" required placeholder="235 Sunrise Road - New deck" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <DialogFooter className="mt-6">
            <Button disabled={saving}>Add Job</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CustomerDetail() {
  const { found, all, timeZone } = Route.useLoaderData()
  const router = useRouter()

  if (!found) {
    return (
      <EmptyState
        bordered
        icon={SearchX}
        title="Customer not found."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/customers">Back to Customers</Link>
          </Button>
        }
      />
    )
  }
  const { customer, jobs, leads, referredBy, referred, jobsDone, lastJobFinished } = found
  const refresh = () => router.invalidate({ sync: true })
  const name = customerName(customer)
  const referrers = all.filter((c) => c.id !== customer.id).map((c) => ({ id: c.id, name: customerName(c) }))

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/customers">Customers</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
          {customer.clientType === 'commercial' && <Badge variant="secondary">Commercial</Badge>}
          {!customer.okToContact && <Badge variant="secondary">Do not contact</Badge>}
          {customer.reviewLeft && <Badge variant="success">Left a review</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {jobsDone} {jobsDone === 1 ? 'Job' : 'Jobs'} done
          {lastJobFinished && <> · last finished {formatDay(new Date(`${lastJobFinished}T12:00:00Z`), timeZone)}</>}
          {customer.customerSince && <> · Customer since {formatDay(customer.customerSince, timeZone)}</>}
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {/* Keyed on updatedAt so a save (or someone else's) resets the form to what was stored. */}
          <DetailsCard key={customer.updatedAt.toString()} customer={customer} referrers={referrers} timeZone={timeZone} refresh={refresh} />
        </div>

        <aside className="min-w-0 self-start overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs xl:sticky xl:top-6">
          <RailSection title="Jobs" icon={Hammer} action={<AddJob customerId={customer.id} city={customer.city} />}>
            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Jobs yet.</p>
            ) : (
              <ul className="space-y-2">
                {jobs.map((j) => (
                  <li key={j.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <Link to="/jobs/$id" params={{ id: j.id }} className="font-medium hover:underline">
                        {j.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {[j.startDate && `Starts ${j.startDate}`, formatMoney(j.quotedPriceCents)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-xs', JOB_STATUS_STYLES[j.status])}>{JOB_STATUS_LABELS[j.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
          <RailSection title="Leads" icon={UserRoundCheck}>
            {leads.length === 0 ? (
              <p className="text-sm text-muted-foreground">Added by hand, no Leads.</p>
            ) : (
              <ul className="space-y-2">
                {leads.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link to="/leads/$id" params={{ id: l.id }} className="min-w-0 truncate hover:underline">
                      {l.serviceType ?? leadName(l)} <span className="text-muted-foreground">· {formatDay(l.createdAt, timeZone)}</span>
                    </Link>
                    <Badge variant={l.stage === 'won' ? 'success' : 'secondary'}>{STAGE_LABELS[l.stage]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
          <RailSection title="Referrals" icon={UserRoundCheck}>
            <p className="text-sm">
              <span className="text-muted-foreground">Referred by </span>
              {referredBy ? (
                <Link to="/customers/$id" params={{ id: referredBy.id }} className="hover:underline">
                  {customerName(referredBy)}
                </Link>
              ) : (
                (customer.referredByName ?? 'nobody on file')
              )}
            </p>
            {referred.length > 0 && (
              <p className="text-sm">
                <span className="text-muted-foreground">Referred </span>
                {referred.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ', '}
                    <Link to="/customers/$id" params={{ id: r.id }} className="hover:underline">
                      {customerName(r)}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </RailSection>
        </aside>
      </div>
    </div>
  )
}
