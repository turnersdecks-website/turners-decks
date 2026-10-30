import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { SearchX, Trash2, UserRound } from 'lucide-react'
import { useState, type ComponentType, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { EstimateSnapshots } from '#/components/EstimateSnapshots'
import { EmptyState } from '#/components/empty-state'
import { LeadActivity } from '#/components/LeadActivity'
import { QuoteFiles } from '#/components/QuoteFiles'
import { LeadFieldsForm, useLeadDraft } from '#/components/LeadForm'
import { PhotosPanel } from '#/components/PhotosPanel'
import { Badge } from '#/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'
import { Checkbox } from '#/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import type { PipelineStage } from '#/db/schema'
import { formatWhen } from '#/lib/dates'
import { errorMessage } from '#/lib/errors'
import { listEstimateSnapshots } from '#/lib/estimate-snapshots.functions'
import { listCustomers } from '#/lib/customers.functions'
import { listLeadFiles } from '#/lib/lead-files.functions'
import { assignLead, deleteLead, getLead, listAssignableStaff, moveLeadStage, setDoNotContact, updateLead } from '#/lib/leads.functions'
import { STAGES, STAGE_LABELS, STAGE_STYLES, leadName } from '#/lib/pipeline'
import { getCompanySettings } from '#/lib/settings.functions'
import { cn } from '#/lib/utils'
import { customerName } from '#/lib/customer-vocab'

// Lead detail, ported from Pine & Gable (itself the Lovable /leads/$id in the Admin Kit issue-detail layout,
// issue-detail-1/2): a header with the breadcrumb, name and the actions bar (admin-only Delete Lead), then the kit's
// underline tabs (ecommerce/product-detail-1). Homeowner: the editable fields with the Stage dropdown in their card
// header, beside a right rail of key/value rows (details, Assigned to). Activities: the activity timeline and stage
// history. Estimate (FLW-203): the Lead's Estimate snapshots from the online estimator. Quote: the five Quote file
// slots (QuoteFiles).
// Not in Good Cover v1 (they come back with their features): Pine & Gable's saved Estimates, Book appointment,
// Send mailer, and the Prospect history / Possible Prospects rail sections.
// The tab lives in `?tab=` (no param = Homeowner), so SSR renders the right one; every panel stays mounted (hidden
// when inactive) so a half-typed note or Homeowner edit survives a tab switch.
const LEAD_TABS = ['activities', 'estimate', 'quote', 'photos'] as const
type LeadTab = (typeof LEAD_TABS)[number]

async function loadLeadPage(leadId: string) {
  const notFoundAsNull = (error: unknown) => {
    if (error instanceof Response && error.status === 404) return null
    throw error
  }
  const input = { data: { leadId } }
  const [found, files, snapshots, staff, settings, customers] = await Promise.all([
    getLead(input).catch(notFoundAsNull),
    listLeadFiles(input),
    listEstimateSnapshots(input),
    listAssignableStaff(),
    getCompanySettings(),
    listCustomers(),
  ])
  const referrers = customers.map((c) => ({ id: c.id, name: customerName(c) }))
  return { found, files, snapshots, staff, referrers, timeZone: settings.timezone }
}
export const Route = createFileRoute('/_staff/leads_/$id')({
  head: () => ({ meta: [{ title: 'Lead - Turner’s Decks CRM' }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: LeadTab } => ({
    tab: LEAD_TABS.find((t) => t === search.tab),
  }),
  // A tab click changes only the search: keep the loaded data (router.invalidate() still reloads).
  loaderDeps: () => ({}),
  shouldReload: ({ cause }) => cause !== 'stay',
  loader: ({ params }) => loadLeadPage(params.id),
  component: LeadDetail,
})

// Kit issue-detail-1 rail parts: bordered sections of label/value rows.
function RailSection({ title, icon: Icon, label, children }: { title?: string; icon?: ComponentType<{ className?: string }>; label?: string; children: ReactNode }) {
  return (
    <section aria-label={label ?? title} className="space-y-2 border-b px-4 py-4 last:border-b-0 sm:px-5">
      {title && (
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {Icon && <Icon className="size-4 text-muted-foreground" />}
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}

function RailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

type LeadRow = NonNullable<Awaited<ReturnType<typeof getLead>>>['lead']

/**
 * The Homeowner card: a `div`, so the header (with the Stage dropdown) sits outside the `<form>`, which wraps only the
 * fields and the Save footer. Keyed by Lead id. While Save runs, the fields and Save are locked (decision 6).
 */
function HomeownerCard({ lead, referrers, timeZone, busy, onStage, refresh }: { lead: LeadRow; referrers: { id: string; name: string }[]; timeZone: string; busy: boolean; onStage: (stage: PipelineStage) => void; refresh: () => Promise<void> }) {
  const draft = useLeadDraft(lead)
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateLead({ data: { leadId: lead.id, ...draft.fields } })
      toast.success('Saved')
      await refresh()
      draft.adopt()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const stageDot = (stage: PipelineStage) => <span className={cn('size-2 shrink-0 rounded-full', STAGE_STYLES[stage].dot)} aria-hidden />

  return (
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs" data-slot="homeowner-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <UserRound className="size-4" aria-hidden />
          </span>
          <h2 className="text-sm font-semibold">Homeowner</h2>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="lead-stage" className="text-xs text-muted-foreground">
            Stage
          </Label>
          <Select value={lead.stage} disabled={busy} onValueChange={(stage) => onStage(stage as PipelineStage)}>
            <SelectTrigger id="lead-stage" aria-label="Pipeline stage" className="h-8 w-40">
              {/* Explicit children so the server HTML shows the current stage too. */}
              <SelectValue>
                <span className="flex items-center gap-2">
                  {stageDot(lead.stage)}
                  {STAGE_LABELS[lead.stage]}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  <span className="flex items-center gap-2">
                    {stageDot(s)}
                    {STAGE_LABELS[s]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <form onSubmit={save} data-dirty={draft.dirty}>
        <fieldset disabled={saving} className="min-w-0">
          <div className="p-4 sm:p-5">
            <LeadFieldsForm value={draft.fields} onChange={draft.setFields} referrers={referrers} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3">
            <p className="text-xs text-muted-foreground">Last updated {formatWhen(lead.updatedAt, timeZone)}</p>
            <Button size="sm" disabled={busy}>
              Save changes
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  )
}

const panelClass = 'mt-0 data-[state=inactive]:hidden'

function LeadDetail() {
  const { found, files, snapshots, staff, referrers, timeZone } = Route.useLoaderData()
  const { staff: me } = Route.useRouteContext()
  const { tab } = Route.useSearch()
  const router = useRouter()
  const navigate = useNavigate({ from: Route.fullPath })
  const [busy, setBusy] = useState(false)

  if (!found) {
    return (
      <EmptyState
        bordered
        icon={SearchX}
        title="Lead not found."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/crm">Back to the Pipeline</Link>
          </Button>
        }
      />
    )
  }
  const { lead, activity, stageHistory, customer } = found
  // `sync` waits for the new loader data. A plain invalidate() reloads stale-while-revalidate: it can resolve with the
  // old data while the reload is still pending, and the Homeowner card would adopt the old fields after a Save.
  const refresh = () => router.invalidate({ sync: true })

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true)
    try {
      await action()
      if (done) toast.success(done)
      await refresh()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await deleteLead({ data: { leadId: lead.id } })
      toast.success('Lead deleted')
      await navigate({ to: '/crm' })
    } catch (error) {
      toast.error(await errorMessage(error))
      setBusy(false)
    }
  }

  const name = leadName(lead)

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/crm">Pipeline</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
              {lead.needsReview && <Badge variant="destructive">Needs review</Badge>}
              {lead.doNotContact && <Badge variant="secondary">Do not contact</Badge>}
            </div>
          </div>
          {/* Actions bar: the Lead's actions (Pine & Gable's Book appointment and Send mailer are not in v1). */}
          <div className="flex flex-wrap items-center gap-2" data-slot="lead-actions">
            {me.role === 'admin' && (
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy}>
                    <Trash2 />
                    Delete Lead
                  </Button>
                }
                title="Delete this Lead?"
                description={`${name} and all of its activity, Follow-ups and Quote files are deleted. This cannot be undone.`}
                confirmLabel="Delete Lead"
                destructive
                pending={busy}
                onConfirm={remove}
              />
            )}
          </div>
        </div>
      </header>

      <Tabs
        value={tab ?? 'homeowner'}
        onValueChange={(v) => void navigate({ search: { tab: v === 'homeowner' ? undefined : (v as LeadTab) }, replace: true, resetScroll: false })}
        className="flex flex-col gap-6"
      >
        <div className="overflow-x-auto border-b">
          <TabsList variant="line">
            <TabsTrigger variant="line" value="homeowner">
              Homeowner
            </TabsTrigger>
            <TabsTrigger variant="line" value="activities">
              Activities
            </TabsTrigger>
            <TabsTrigger variant="line" value="estimate">
              Estimate
            </TabsTrigger>
            <TabsTrigger variant="line" value="quote">
              Quote
            </TabsTrigger>
            <TabsTrigger variant="line" value="photos">
              Photos
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="homeowner" forceMount className={panelClass}>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
              <HomeownerCard
                key={lead.id}
                lead={lead}
                referrers={referrers.filter((r) => r.id !== lead.customerId)}
                timeZone={timeZone}
                busy={busy}
                onStage={(stage) =>
                  run(() => moveLeadStage({ data: { leadId: lead.id, stage } }), stage === 'won' ? 'Won. Added to Customers with a new Job.' : undefined)
                }
                refresh={refresh}
              />
            </div>

            <aside className="min-w-0 self-start overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs xl:sticky xl:top-6">
              <RailSection label="Lead details">
                <RailRow label="Source">{lead.source}</RailRow>
                <RailRow label="First source">{lead.firstSource}</RailRow>
                <RailRow label="Created">{formatWhen(lead.createdAt, timeZone)}</RailRow>
                {lead.leadScore != null && <RailRow label="Lead score">{lead.leadScore}</RailRow>}
              </RailSection>
              {customer && (
                <RailSection label="Customer">
                  <RailRow label="Customer">
                    <Link to="/customers/$id" params={{ id: customer.id }} className="font-medium hover:underline">
                      {customerName(customer)}
                    </Link>
                  </RailRow>
                </RailSection>
              )}
              <RailSection label="Marketing">
                <label className="flex items-start gap-2.5 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={lead.doNotContact}
                    disabled={busy}
                    onCheckedChange={(v) => run(() => setDoNotContact({ data: { leadId: lead.id, value: v === true } }))}
                  />
                  <span>
                    <span className="font-medium">Do not contact</span>
                    <span className="block text-xs text-muted-foreground">Leave out of marketing and re-engaging cold Leads (e.g. went with a competitor, not a good fit).</span>
                  </span>
                </label>
              </RailSection>
              <RailSection label="Assigned to">
                <label className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Assigned to</span>
                  <select
                    value={lead.assignedTo ?? ''}
                    disabled={busy}
                    onChange={(e) => run(() => assignLead({ data: { leadId: lead.id, staffId: e.target.value || null } }))}
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:opacity-50 dark:bg-input/30"
                  >
                    <option value="">Nobody</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </RailSection>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="activities" forceMount className={panelClass}>
          <LeadActivity leadId={lead.id} phone={lead.phone} activity={activity} stageHistory={stageHistory} timeZone={timeZone} onChange={refresh} />
        </TabsContent>

        <TabsContent value="estimate" forceMount className={panelClass}>
          <EstimateSnapshots snapshots={snapshots} timeZone={timeZone} />
        </TabsContent>

        <TabsContent value="quote" forceMount className={panelClass}>
          <QuoteFiles leadId={lead.id} files={files} timeZone={timeZone} onChange={refresh} />
        </TabsContent>

        <TabsContent value="photos" forceMount className={panelClass}>
          <PhotosPanel key={lead.id} target={{ leadId: lead.id }} timeZone={timeZone} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
