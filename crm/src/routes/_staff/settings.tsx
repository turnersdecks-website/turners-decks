import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { Building2, Mail, MessagesSquare, Plug, Save } from 'lucide-react'
import { MessageLogSection } from '#/components/MessageLog'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '#/components/page'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Separator } from '#/components/ui/separator'
import { Textarea } from '#/components/ui/textarea'
import { errorMessage } from '#/lib/errors'
import { updateEstimateEmailTemplate } from '#/lib/estimator-settings.functions'
import { ESTIMATE_EMAIL_PLACEHOLDERS } from '#/lib/estimator/email-template'
import { type CompanySettingsInput, getCompanySettings, updateCompanySettings } from '#/lib/settings.functions'
import { createPhotoDevice, listPhotoDevices, revokePhotoDevice } from '#/lib/photos.functions'
import { type TemplateKey, templateDef } from '#/lib/email-templates'
import { listEmailTemplates, saveEmailTemplate } from '#/lib/email-templates.functions'
import { applyQboRules, disconnectQbo, getQboRules, getQboStatus, saveQboRulesFn, syncQboNow } from '#/lib/qbo.functions'
import type { VendorRule } from '#/lib/qbo-vocab'
import { connectQuoNumber, getTextingSettings, updateTextingSettings } from '#/lib/texting.functions'
import { prettyPhone } from '#/lib/phone'
import { DEFAULT_NEW_LEAD_TEMPLATE, NEW_LEAD_PLACEHOLDERS, renderNewLeadText } from '#/lib/new-lead-text'
import { cn } from '#/lib/utils'

// Settings (admins), ported from Pine & Gable's /settings and regrouped into three tabs:
// - Company: name, contact, timezone, Owner alert emails; the Photo home screen for Pat's phone
// - Automations: Customer email templates (incl. the Estimate email) and texting rules (on/off, Pat's cell)
// - Connections: Quo and QuickBooks (connect, status, sync)
// - Message log: emails and texts the CRM sent or tried to send, with errors; Retry or Dismiss failed ones
// Your profile moved to /profile (the avatar menu). Staff who are not admins are sent there. Server guards are the real
// check (requireAdmin on every company write). Old hash links (#texting, #quickbooks...) land on the right tab.
const TABS = [
  { id: 'company', title: 'Company', icon: Building2 },
  { id: 'automations', title: 'Automations', icon: Mail },
  { id: 'connections', title: 'Connections', icon: Plug },
  { id: 'messages', title: 'Message log', icon: MessagesSquare },
] as const
type TabId = (typeof TABS)[number]['id']
const HASH_TAB: Record<string, TabId> = { company: 'company', 'photo-home': 'company', 'email-templates': 'automations', texting: 'connections', quickbooks: 'connections' }

export const Route = createFileRoute('/_staff/settings')({
  validateSearch: (s: Record<string, unknown>): { tab?: TabId; qbo?: string } => ({
    tab: TABS.some((t) => t.id === s.tab) ? (s.tab as TabId) : undefined,
    qbo: typeof s.qbo === 'string' ? s.qbo.slice(0, 40) : undefined,
  }),
  beforeLoad: ({ context }) => {
    if (context.staff.role !== 'admin') throw redirect({ to: '/profile' })
  },
  head: () => ({ meta: [{ title: 'Settings - Turner’s Decks CRM' }, { name: 'description', content: 'Company info, automations and connections.' }] }),
  loader: async () => ({ settings: await getCompanySettings() }),
  component: SettingsPage,
})

function SettingsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const tab = search.tab ?? 'company'
  const { settings } = Route.useLoaderData()
  // An old link with a hash (e.g. /settings#quickbooks) opens the tab that section lives on now.
  useEffect(() => {
    const t = HASH_TAB[window.location.hash.slice(1)]
    if (t && t !== tab) void navigate({ to: '/settings', search: (s: Record<string, unknown>) => ({ ...s, tab: t }) as never, replace: true })
  }, [])

  return (
    <div>
      <PageHeader title="Settings" description="Company info, automations and connections." />
      <div role="tablist" aria-label="Settings" className="mb-8 flex gap-1 border-b">
        {TABS.map(({ id, title, icon: Icon }) => (
          <Link
            key={id}
            to="/settings"
            search={{ tab: id }}
            role="tab"
            aria-selected={tab === id}
            className={cn(
              '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium transition',
              tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {title}
          </Link>
        ))}
      </div>
      <div className={cn("space-y-10", tab === "messages" ? "max-w-5xl" : "max-w-3xl")}>
        {tab === 'company' && (
          <>
            <CompanySection />
            <PhotoHomeSection />
          </>
        )}
        {tab === 'automations' && <AutomationsTab />}
        {tab === 'connections' && (
          <>
            <QuoConnectionSection />
            <QuickBooksSection />
            <QboRulesSection />
          </>
        )}
        {tab === 'messages' && <MessageLogSection timeZone={settings.timezone} />}
      </div>
    </div>
  )
}

/** Kit settings ContentSection: title and description, a separator, then the section body. */
function ContentSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <Separator className="my-4" />
      {children}
    </section>
  )
}

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC']
const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30'

function CompanySection() {
  const { settings } = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState<CompanySettingsInput>({
    name: settings.name,
    phone: settings.phone ?? '',
    email: settings.email ?? '',
    serviceArea: settings.serviceArea ?? '',
    businessNumber: settings.businessNumber ?? '',
    timezone: settings.timezone,
    ownerAlertEmails: settings.ownerAlertEmails ?? '',
  })

  async function save() {
    setBusy(true)
    try {
      await updateCompanySettings({ data: f })
      toast.success('Settings saved')
      await router.invalidate()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const field = (k: keyof CompanySettingsInput, label: string, props: React.ComponentProps<'input'> = {}) => (
    <div className="space-y-2">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </div>
  )

  return (
    <>
      {/* Wrapped so the sticky Save bar stays with the Company form and does not float over the Estimate email. */}
      <div className="space-y-10">
        <ContentSection id="company" title="Company">
          <Card className="shadow-xs">
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
              {field('name', 'Company name', { required: true })}
              {field('phone', 'Phone', { type: 'tel' })}
              {field('email', 'Email', { type: 'email' })}
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <select id="timezone" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} className={selectClass}>
                  {(TIMEZONES.includes(f.timezone) ? TIMEZONES : [f.timezone, ...TIMEZONES]).map((tz) => (
                    <option key={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">{field('serviceArea', 'Service area')}</div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ownerAlertEmails">Owner alert emails</Label>
                <Textarea
                  id="ownerAlertEmails"
                  rows={2}
                  value={f.ownerAlertEmails}
                  placeholder="turnersdecks@gmail.com"
                  onChange={(e) => setF({ ...f, ownerAlertEmails: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Where new-Lead Owner alert emails go. Separate addresses with commas.</p>
              </div>
            </CardContent>
          </Card>
        </ContentSection>
  
        {/* One save for the Company form, kept in reach while scrolling. */}
        <div className="sticky bottom-0 z-10 -mx-4 flex justify-end border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:px-0">
          <Button onClick={save} disabled={busy} className="max-sm:w-full">
            <Save />
            {busy ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </div>
    </>
  )
}

function AutomationsTab() {
  const { settings } = Route.useLoaderData()
  return (
    <>
      <EmailTemplatesSection calculatorTemplate={settings.estimateEmailTemplate} />
      <TextingRulesSection />
    </>
  )
}

/** GLOSSARY Customer email template: every email a Homeowner gets from us, each editable. */
function EmailTemplatesSection({ calculatorTemplate }: { calculatorTemplate: string }) {
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof listEmailTemplates>> | null>(null)
  const load = async () => {
    try {
      setTemplates(await listEmailTemplates())
    } catch (error) {
      toast.error(await errorMessage(error))
    }
  }
  useEffect(() => {
    void load()
  }, [])
  return (
    <ContentSection
      id="email-templates"
      title="Customer email templates"
      description="The emails Homeowners get from Turner's Decks. Start with a line like “Subject: …” to set the subject; words in braces are filled in for each Homeowner."
    >
      <div className="space-y-3">
        <CalculatorEmailCard template={calculatorTemplate} />
        {templates?.map((t) => (
          <TemplateCard key={t.key} templateKey={t.key} saved={t.template} isDefault={t.isDefault} onSaved={load} />
        ))}
      </div>
    </ContentSection>
  )
}

/** One template, folded until opened. */
function TemplateShell({ name, when, children }: { name: string; when: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border bg-card shadow-xs">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-4 sm:px-6">
        <span className="min-w-0">
          <span className="block font-medium">{name}</span>
          <span className="block text-sm text-muted-foreground">{when}</span>
        </span>
        <span className="mt-0.5 shrink-0 text-sm text-primary underline-offset-2 group-open:hidden hover:underline">Edit</span>
      </summary>
      <div className="border-t">{children}</div>
    </details>
  )
}

function TemplateCard({ templateKey, saved, isDefault, onSaved }: { templateKey: TemplateKey; saved: string; isDefault: boolean; onSaved: () => Promise<void> }) {
  const def = templateDef(templateKey)
  const [template, setTemplate] = useState(saved)
  const [busy, setBusy] = useState(false)
  useEffect(() => setTemplate(saved), [saved])

  async function save(next: string | null) {
    setBusy(true)
    try {
      await saveEmailTemplate({ data: { key: templateKey, template: next } })
      toast.success(next === null ? `${def.name} reset` : `${def.name} saved`)
      await onSaved()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <TemplateShell name={def.name} when={def.when}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(template)
        }}
        className="space-y-4 p-4 sm:p-6"
      >
        <Textarea aria-label={`${def.name} text`} rows={12} value={template} onChange={(e) => setTemplate(e.target.value)} className="font-mono text-sm" required />
        <ul className="flex flex-wrap gap-1.5" aria-label="Placeholders">
          {def.placeholders.map((p) => (
            <li key={p}>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{${p}}`}</code>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          {!isDefault && (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>
              Reset to default
            </Button>
          )}
          <Button variant="outline" disabled={busy || template === saved}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </TemplateShell>
  )
}

/** The Website calculator email: what a Homeowner gets right after the price calculator (stored in company settings). */
function CalculatorEmailCard({ template: saved }: { template: string }) {
  const router = useRouter()
  const [template, setTemplate] = useState(saved)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await updateEstimateEmailTemplate({ data: { template } })
      toast.success('Website calculator email saved')
      await router.invalidate()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <TemplateShell name="Website calculator email" when="Sends automatically right after someone uses the price calculator on the website, with their price range.">
      <form onSubmit={save}>
        <div className="space-y-4 p-4 sm:p-6">
            <div className="space-y-2">
              <Label htmlFor="estimateEmailTemplate" className="sr-only">Website calculator email text</Label>
              <Textarea
                id="estimateEmailTemplate"
                rows={14}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="font-mono text-sm"
                required
              />
              <p className="text-xs text-muted-foreground">
                Start with a line like “Subject: Your deck estimate” to set the subject. The words in braces are filled in for
                each Homeowner. Keep {'{low}'} and {'{high}'} so they see their range.
              </p>
              <ul className="flex flex-wrap gap-1.5" aria-label="Placeholders">
                {ESTIMATE_EMAIL_PLACEHOLDERS.map((p) => (
                  <li key={p}>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{${p}}`}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" disabled={busy || template === saved}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
        </div>
      </form>
    </TemplateShell>
  )
}

type PhotoDevice = Awaited<ReturnType<typeof listPhotoDevices>>[number]

type QboStatus = Awaited<ReturnType<typeof getQboStatus>>

const QBO_RESULTS: Record<string, [ok: boolean, text: string]> = {
  connected: [true, 'QuickBooks connected. The first sync is running; reload in a minute.'],
  declined: [false, 'QuickBooks was not connected (you cancelled on the Intuit page).'],
  expired: [false, 'That sign-in link expired. Click Connect QuickBooks again.'],
  failed: [false, 'QuickBooks did not accept the connection. Check the app keys, then try again.'],
  'missing-keys': [false, 'Add QBO_CLIENT_ID and QBO_CLIENT_SECRET to the CRM first.'],
}

/**
 * QuickBooks (docs/adr/0006-quickbooks-sync.md): connect once; transactions sync every night (and on Sync now) and
 * are sorted onto Jobs on the Transactions page. Read only: nothing is written to QuickBooks.
 */
function QuickBooksSection() {
  const [st, setSt] = useState<QboStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    try {
      setSt(await getQboStatus())
    } catch (error) {
      toast.error(await errorMessage(error))
    }
  }
  useEffect(() => {
    void load()
    const result = new URLSearchParams(window.location.search).get('qbo')
    const msg = result ? QBO_RESULTS[result] : undefined
    if (msg) (msg[0] ? toast.success : toast.error)(msg[1])
  }, [])

  async function sync() {
    setBusy(true)
    try {
      const r = await syncQboNow()
      toast.success(`Synced: ${r.saved} transactions read, ${r.matched} put on Jobs automatically.`)
      await load()
    } catch (error) {
      toast.error(await errorMessage(error))
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ContentSection id="quickbooks" title="QuickBooks" description="Transactions copy into the CRM every night, so Jobs show their costs and invoices, and Claude can read them. Nothing is written to QuickBooks.">
      {!st ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card className="shadow-xs">
          <CardContent className="space-y-4 p-4 text-sm sm:p-6">
            {!st.hasKeys ? (
              <p className="text-muted-foreground">
                Add the Intuit app keys to this CRM in Cloudflare as secrets named QBO_CLIENT_ID and QBO_CLIENT_SECRET, then come back. The app's redirect URI must be{' '}
                <span className="font-mono text-xs break-all select-all">{st.redirectUri}</span>
              </p>
            ) : st.connected ? (
              <div className="space-y-1">
                <p>
                  Connected on {new Date(st.connected.connectedAt).toLocaleDateString()}. {st.transactions} transactions,{' '}
                  <Link to="/transactions" className="underline">
                    {st.unassigned} to sort
                  </Link>
                  .
                </p>
                <p className="text-muted-foreground">Last sync: {st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString() : 'not yet'}</p>
                {st.lastSyncError && <p className="text-destructive">Last sync failed: {st.lastSyncError}</p>}
              </div>
            ) : (
              <p className="text-muted-foreground">Not connected yet.</p>
            )}
            {st.hasKeys && (
              <div className="flex flex-wrap gap-2">
                <Button asChild variant={st.connected ? 'outline' : 'default'} size="sm">
                  <a href="/api/qbo/connect">{st.connected ? 'Reconnect QuickBooks' : 'Connect QuickBooks'}</a>
                </Button>
                {st.connected && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={sync}>
                    {busy ? 'Syncing…' : 'Sync now'}
                  </Button>
                )}
                {st.connected && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm('Disconnect QuickBooks? The CRM stops reading it. Transactions already copied stay.')) return
                      try {
                        await disconnectQbo()
                        toast.success('QuickBooks disconnected')
                      } catch (error) {
                        toast.error(await errorMessage(error))
                      }
                      await load()
                    }}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Redirect URI for the Intuit app: <span className="font-mono break-all select-all">{st.redirectUri}</span></p>
          </CardContent>
        </Card>
      )}
    </ContentSection>
  )
}

type TextingSettings = Awaited<ReturnType<typeof getTextingSettings>>

/**
 * Texting (docs/adr/0004-quo-texting.md). Connect Quo makes the webhook, so texts and calls to the Quo number land on
 * Leads right away. Sending texts (instant reply to website Leads, photo links to Pat) waits for the switch, which
 * goes on only after Quo shows carrier registration (A2P 10DLC) approved.
 */
/** Loads texting settings for both halves (Connections: Quo; Automations: rules). */
function useTexting() {
  const [t, setT] = useState<TextingSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    try {
      setT(await getTextingSettings())
    } catch (error) {
      toast.error(await errorMessage(error))
    }
  }
  useEffect(() => {
    void load()
  }, [])
  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await fn()
      toast.success(done)
      await load()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return { t, setT, busy, run }
}

/** Connections > Quo: the API key status and Connect Quo (makes the webhook). */
function QuoConnectionSection() {
  const { settings } = Route.useLoaderData()
  const { t, busy, run } = useTexting()
  const [phone, setPhone] = useState(settings.businessNumber ? prettyPhone(settings.businessNumber) : '')
  return (
    <ContentSection id="quo" title="Quo (phone and texting)" description="Texts and calls to the Quo number show up on Leads as soon as Quo is connected.">
      {!t ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card className="shadow-xs">
          <CardContent className="space-y-3 p-4 text-sm sm:p-6">
            {!t.hasApiKey ? (
              <p className="text-muted-foreground">Add the Quo API key (Quo › Settings › API) to this CRM in Cloudflare as a secret named QUO_API_KEY, then come back.</p>
            ) : t.connected ? (
              <p>
                Connected to {prettyPhone(t.connected.phoneNumberE164)} on {new Date(t.connected.connectedAt).toLocaleDateString()}.
              </p>
            ) : (
              <p className="text-muted-foreground">Not connected yet.</p>
            )}
            {t.hasApiKey && (
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(() => connectQuoNumber({ data: { phone } }), 'Quo connected')
                }}
              >
                <Input aria-label="Quo number" placeholder="(484) 939-3325" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <Button variant="outline" disabled={busy}>
                  {t.connected ? 'Reconnect' : 'Connect Quo'}
                </Button>
              </form>
            )}
            <p className="text-xs text-muted-foreground">Quo sends texts and calls to {t.webhookUrl}</p>
          </CardContent>
        </Card>
      )}
    </ContentSection>
  )
}

/**
 * Automations > Texting: whether the CRM sends texts (instant reply to website Leads, photo links to Pat) and Pat's
 * cell. Switched on only after Quo shows carrier registration (A2P 10DLC) approved (docs/adr/0004-quo-texting.md).
 */
function TextingRulesSection() {
  const { t, setT, busy, run } = useTexting()
  const [mobile, setMobile] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [template, setTemplate] = useState<string | null>(null)
  const shownMobile = mobile ?? (t?.ownerMobile ? prettyPhone(t.ownerMobile) : '')
  const shownTo = to ?? (t ? t.newLeadTextTo.map(prettyPhone).join(', ') : '')
  const shownTemplate = template ?? t?.newLeadTextTemplate ?? DEFAULT_NEW_LEAD_TEMPLATE
  const preview = renderNewLeadText(shownTemplate, {
    how: 'Estimator',
    name: 'Jane Smith',
    project: 'Deck replacement',
    size: '320 sq ft',
    material: 'Composite',
    estimate: '$15,000 to $18,500',
    timeframe: 'Ready to start soon',
    address: '12 Main St, Exeter',
    town: 'Exeter',
    phone: '(484) 555-0101',
    email: 'jane@example.com',
    notes: 'Want to replace the old deck before summer.',
    link: 'crm.turnersdecks.com/leads/…',
  })
  return (
    <ContentSection id="texting" title="Texting" description="Automatic texts from the Quo number. Connect Quo first, under Connections.">
      {!t ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card className="shadow-xs">
          <CardContent className="space-y-5 p-4 sm:p-6">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={t.textingEnabled}
                disabled={busy || (!t.textingEnabled && !(t.hasApiKey && t.connected))}
                onChange={(e) => setT({ ...t, textingEnabled: e.target.checked })}
              />
              <span>
                Texting is on. Turn this on only after Quo › Settings › Trust shows carrier registration approved; carriers block business texts from
                unregistered numbers. When on, website Leads who tick “Text me about my project” get an instant text, a new number's first text gets a
                reply, new Leads are texted to the numbers below, and photo links can be texted to Pat.
              </span>
            </label>
            <div className="space-y-2">
              <Label htmlFor="ownerMobile">Pat's cell (photo-link texts go here)</Label>
              <Input id="ownerMobile" type="tel" value={shownMobile} placeholder="(484) 555-0123" onChange={(e) => setMobile(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newLeadTextTo">Text new Leads to</Label>
              <Input id="newLeadTextTo" value={shownTo} placeholder="(484) 555-0123, (610) 555-0199" onChange={(e) => setTo(e.target.value)} />
              <p className="text-xs text-muted-foreground">Cell numbers, separated by commas. Every new Lead from the website, a text or a call. Left empty, it goes to Pat's cell.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newLeadTextTemplate">New Lead text</Label>
              <Textarea id="newLeadTextTemplate" rows={10} value={shownTemplate} onChange={(e) => setTemplate(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Fill-ins: {NEW_LEAD_PLACEHOLDERS.map((k) => `{${k}}`).join(' ')}. A blank fill-in drops out with its comma or period, and a line like “Size: {'{size}'}” drops out when there is no size.
              </p>
              <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-line">{preview}</div>
            </div>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  () => updateTextingSettings({ data: { textingEnabled: t.textingEnabled, ownerMobile: shownMobile, newLeadTextTo: shownTo, newLeadTextTemplate: shownTemplate } }),
                  'Texting saved',
                )
              }
            >
              <Save />
              Save texting
            </Button>
          </CardContent>
        </Card>
      )}
    </ContentSection>
  )
}

/** GLOSSARY Photo home screen: a saved link on Pat's phone listing every photo request. The link is shown once. */
function PhotoHomeSection() {
  const [devices, setDevices] = useState<PhotoDevice[]>([])
  const [name, setName] = useState("Pat's phone")
  const [made, setMade] = useState<{ name: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      setDevices(await listPhotoDevices())
    } catch (error) {
      toast.error(await errorMessage(error))
    }
  }
  useEffect(() => {
    void load()
  }, [])

  async function make(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      setMade(await createPhotoDevice({ data: { name } }))
      await load()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ContentSection
      id="photo-home"
      title="Photo home screen"
      description="One link saved on Pat's phone that lists every photo request still open. Anyone with it can add photos, so turn it off if the phone is lost."
    >
      <div className="space-y-4">
        {made && (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
            <p className="font-medium">Link for {made.name} (shown once):</p>
            <p className="font-mono text-xs break-all select-all">{made.url}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <a href={`sms:?&body=${encodeURIComponent(`Your Turner's Decks photo list. Open it, then Share > Add to Home Screen: ${made.url}`)}`}>Text it</a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(made.url).then(() => toast.success('Link copied'), () => toast.error('Could not copy.'))}
              >
                Copy link
              </Button>
            </div>
          </div>
        )}
        {devices.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
                <span>
                  {d.name}
                  <span className="text-muted-foreground"> · {d.lastUsedAt ? `last opened ${new Date(d.lastUsedAt).toLocaleDateString()}` : 'not opened yet'}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={async () => {
                    try {
                      await revokePhotoDevice({ data: { id: d.id } })
                      toast.success('Turned off')
                      await load()
                    } catch (error) {
                      toast.error(await errorMessage(error))
                    }
                  }}
                >
                  Turn off
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={make} className="flex flex-col gap-2 sm:flex-row">
          <Input aria-label="Phone name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Button variant="outline" disabled={busy}>
            Make a link
          </Button>
        </form>
      </div>
    </ContentSection>
  )
}

// Which QuickBooks costs need sorting (docs/adr/0006-quickbooks-sync.md). New costs in a ticked account land in To sort;
// the rest arrive Ignored. A vendor rule wins over the account. Invoices and payments always come in to be sorted.
function QboRulesSection() {
  const [view, setView] = useState<Awaited<ReturnType<typeof getQboRules>> | null>(null)
  const [accounts, setAccounts] = useState<string[]>([])
  const [vendors, setVendors] = useState<VendorRule[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    getQboRules().then(
      (v) => {
        setView(v)
        setAccounts(v.rules.sortAccounts)
        setVendors(v.rules.vendors)
      },
      () => setView(null),
    )
  }, [])
  if (!view) return null

  async function save() {
    setBusy(true)
    try {
      const saved = await saveQboRulesFn({ data: { sortAccounts: accounts, vendors: vendors.filter((v) => v.vendor.trim()) } })
      setAccounts(saved.sortAccounts)
      setVendors(saved.vendors)
      toast.success('Rules saved. New transactions follow them from the next sync.')
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!window.confirm('Apply the saved rules to everything in To sort now? Costs the rules say to ignore move to Ignored.')) return
    setBusy(true)
    try {
      const r = await applyQboRules()
      toast.success(r.ignored ? `${r.ignored} transactions moved to Ignored.` : 'Nothing in To sort matched an ignore rule.')
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ContentSection id="quickbooks-rules" title="QuickBooks sorting rules" description="Which new costs need sorting onto a Job. Everything else arrives Ignored, ready to un-ignore if it turns out to be a Job cost.">
      <Card className="shadow-xs">
        <CardContent className="space-y-5 p-4 text-sm sm:p-6">
          <fieldset className="space-y-2">
            <legend className="font-medium">Job cost accounts</legend>
            <p className="text-xs text-muted-foreground">Costs booked to these QuickBooks accounts land in To sort.</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {view.accounts.map((a) => (
                <label key={a} className="flex items-center gap-2">
                  <input type="checkbox" checked={accounts.includes(a)} onChange={(e) => setAccounts((cur) => (e.target.checked ? [...cur, a] : cur.filter((x) => x !== a)))} />
                  {a}
                </label>
              ))}
            </div>
          </fieldset>
          <Separator />
          <fieldset className="space-y-2">
            <legend className="font-medium">Vendor rules</legend>
            <p className="text-xs text-muted-foreground">Win over the account. Matches the QuickBooks vendor name or the bank description.</p>
            {vendors.map((v, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input aria-label="Vendor" value={v.vendor} placeholder="e.g. Harbor Freight" className="h-8 w-56" onChange={(e) => setVendors((cur) => cur.map((x, j) => (j === i ? { ...x, vendor: e.target.value } : x)))} />
                <select
                  aria-label="Rule"
                  value={v.action}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  onChange={(e) => setVendors((cur) => cur.map((x, j) => (j === i ? { ...x, action: e.target.value === 'sort' ? 'sort' : 'ignore' } : x)))}
                >
                  <option value="ignore">Always ignore</option>
                  <option value="sort">Always to sort</option>
                </select>
                <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setVendors((cur) => cur.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => setVendors((cur) => [...cur, { vendor: '', action: 'ignore' }])}>
              Add vendor rule
            </Button>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={save}>
              <Save className="size-4" /> Save rules
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={apply}>
              Apply to To sort now
            </Button>
          </div>
        </CardContent>
      </Card>
    </ContentSection>
  )
}
