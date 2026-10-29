import { PhotosPanel } from '#/components/PhotosPanel'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Calculator, Hammer, MapPin, SearchX } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { JobFields, type JobDraft, jobDraftFrom } from '#/components/CustomerForms'
import { EmptyState } from '#/components/empty-state'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import { JOB_STATUS_LABELS, JOB_STATUS_STYLES, customerName, formatMoney, jobMetrics } from '#/lib/customer-vocab'
import { getJob, updateJob } from '#/lib/customers.functions'
import { formatWhen } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'
import { getCompanySettings } from '#/lib/settings.functions'
import { cn } from '#/lib/utils'

// A Job (GLOSSARY): the project form on the left; the Customer, where to go, and the tracker's numbers on the right.

async function loadJobPage(jobId: string) {
  const notFoundAsNull = (error: unknown) => {
    if (error instanceof Response && error.status === 404) return null
    throw error
  }
  const [found, settings] = await Promise.all([getJob({ data: { jobId } }).catch(notFoundAsNull), getCompanySettings()])
  return { found, timeZone: settings.timezone }
}

export const Route = createFileRoute('/_staff/jobs_/$id')({
  head: () => ({ meta: [{ title: 'Job - Turner’s Decks CRM' }] }),
  loader: ({ params }) => loadJobPage(params.id),
  component: JobDetail,
})

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 tabular-nums">{children}</span>
    </div>
  )
}

type Found = NonNullable<Awaited<ReturnType<typeof loadJobPage>>['found']>

/** The form's draft as the server input: number fields go as text (the server reads "$1,250" and "1250"). */
const jobInput = (d: JobDraft) => d

function JobCard({ job, timeZone, refresh }: { job: Found['job']; timeZone: string; refresh: () => Promise<void> }) {
  const [draft, setDraft] = useState<JobDraft>(() => jobDraftFrom(job))
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateJob({ data: { jobId: job.id, ...jobInput(draft) } })
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
          <Hammer className="size-4" aria-hidden />
        </span>
        <h2 className="text-sm font-semibold">Job</h2>
      </div>
      <fieldset disabled={saving} className="min-w-0">
        <div className="p-4 sm:p-5">
          <JobFields value={draft} onChange={setDraft} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3">
          <p className="text-xs text-muted-foreground">Last updated {formatWhen(job.updatedAt, timeZone)}</p>
          <Button size="sm">Save changes</Button>
        </div>
      </fieldset>
    </form>
  )
}

function JobDetail() {
  const { found, timeZone } = Route.useLoaderData()
  const router = useRouter()

  if (!found) {
    return (
      <EmptyState
        bordered
        icon={SearchX}
        title="Job not found."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/jobs">Back to Jobs</Link>
          </Button>
        }
      />
    )
  }
  const { job, customer } = found
  const refresh = () => router.invalidate({ sync: true })
  const m = jobMetrics(job)
  const blank = (v: string | number | null, unit = '') => (v === null || v === '' ? <span className="text-muted-foreground">needs numbers</span> : `${v}${unit}`)

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/jobs">Jobs</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{job.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{job.name}</h1>
          <span className={cn('rounded-md border px-1.5 py-0.5 text-xs', JOB_STATUS_STYLES[job.status])}>{JOB_STATUS_LABELS[job.status]}</span>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <JobCard key={job.updatedAt.toString()} job={job} timeZone={timeZone} refresh={refresh} />
          <PhotosPanel key={job.id} target={{ jobId: job.id }} defaultStage="after" timeZone={timeZone} />
        </div>
        <aside className="min-w-0 space-y-6 self-start xl:sticky xl:top-6">
          <section aria-label="Customer" className="space-y-2 rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <MapPin className="size-4 text-muted-foreground" />
              Customer
            </h2>
            <p className="text-sm">
              <Link to="/customers/$id" params={{ id: customer.id }} className="font-medium hover:underline">
                {customerName(customer)}
              </Link>
            </p>
            {customer.phone && (
              <p className="text-sm">
                <a href={`tel:${customer.phone}`} className="hover:underline">
                  {customer.phone}
                </a>
              </p>
            )}
            {(customer.street || customer.city) && <p className="text-sm text-muted-foreground">{[customer.street, customer.city].filter(Boolean).join(', ')}</p>}
            {job.leadId && (
              <p className="text-sm">
                <Link to="/leads/$id" params={{ id: job.leadId }} className="hover:underline">
                  Open the Lead
                </Link>
              </p>
            )}
          </section>
          <section aria-label="Numbers" className="space-y-1 rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Calculator className="size-4 text-muted-foreground" />
              Numbers
            </h2>
            <Row label="Labor hours / 100 sq ft">{blank(m.laborHoursPer100Sqft)}</Row>
            <Row label="Material variance">{m.materialVarianceCents === null ? blank(null) : `${m.materialVarianceCents > 0 ? '+' : ''}${formatMoney(m.materialVarianceCents)}`}</Row>
            <Row label="Gross margin">{m.grossMarginCents === null ? blank(null) : formatMoney(m.grossMarginCents)}</Row>
            <Row label="Gross margin %">{blank(m.grossMarginPct, '%')}</Row>
            <p className="pt-2 text-xs text-muted-foreground">Saved numbers only. Labor cost is entered by hand; no labor rate is assumed.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
