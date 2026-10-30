import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Building2, Camera, Mail, Save, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '#/components/page'
import { Button, buttonVariants } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'
import { Separator } from '#/components/ui/separator'
import { Textarea } from '#/components/ui/textarea'
import { errorMessage } from '#/lib/errors'
import { updateEstimateEmailTemplate } from '#/lib/estimator-settings.functions'
import { ESTIMATE_EMAIL_PLACEHOLDERS } from '#/lib/estimator/email-template'
import { type CompanySettingsInput, getCompanySettings, updateCompanySettings, updateProfileName } from '#/lib/settings.functions'
import { createPhotoDevice, listPhotoDevices, revokePhotoDevice } from '#/lib/photos.functions'
import { type TemplateKey, templateDef } from '#/lib/email-templates'
import { listEmailTemplates, saveEmailTemplate } from '#/lib/email-templates.functions'
import { cn } from '#/lib/utils'

// Company settings, ported from Pine & Gable's /settings and cut to v1: Your profile and Company (name, contact,
// timezone, Owner alert emails) and the Estimate email template (FLW-203). Pine & Gable's Roofing products, Estimates, Phone line and Postcard sections come back
// with those features. Every Staff member can rename themselves; everything else is admin only, so staff-role Staff see
// just "Your profile". Server guards are the real check (requireAdmin on every company write).
// Layout (plan 007 K9): kit original/(settings): a section nav on the left (a Select on phones) and content sections
// (title, description, separator, body). One route with hash anchors, so /settings stays the profile link.
export const Route = createFileRoute('/_staff/settings')({
  head: () => ({ meta: [{ title: 'Company settings - Turner’s Decks CRM' }, { name: 'description', content: 'Company info and Owner alerts.' }] }),
  loader: async ({ context }) => {
    if (context.staff.role !== 'admin') return { settings: null }
    return { settings: await getCompanySettings() }
  },
  component: SettingsPage,
})

const SECTIONS = [
  { id: 'profile', title: 'Your profile', icon: UserRound },
  { id: 'company', title: 'Company', icon: Building2 },
  { id: 'email-templates', title: 'Customer email templates', icon: Mail },
  { id: 'photo-home', title: 'Photo home screen', icon: Camera },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

function SettingsPage() {
  const { settings } = Route.useLoaderData()
  const { staff } = Route.useRouteContext()
  const isAdmin = staff.role === 'admin' && settings !== null

  return (
    <div>
      <PageHeader
        title="Company settings"
        description={isAdmin ? 'Your company info and where new-Lead alerts go.' : 'Your name as other Staff see it.'}
      />
      {isAdmin ? (
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-12">
          <aside className="lg:sticky lg:top-20 lg:w-56 lg:shrink-0 lg:self-start">
            <SectionNav />
          </aside>
          <div className="min-w-0 max-w-3xl flex-1 space-y-10">
            <ProfileSection name={staff.name} />
            <AdminSettings />
          </div>
        </div>
      ) : (
        <div className="max-w-3xl">
          <ProfileSection name={staff.name} />
        </div>
      )}
    </div>
  )
}

/** Kit settings sidebar-nav: ghost links (the visible section is highlighted) on wide screens, a Select on phones. */
function SectionNav() {
  const navigate = useNavigate()
  const [active, setActive] = useState<SectionId>('profile')

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null)
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id as SectionId)
      },
      { rootMargin: '-80px 0px -60% 0px' },
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  function go(id: SectionId) {
    setActive(id)
    // Through the router, so its history state (scroll restoration key) survives; the router does the smooth scroll.
    void navigate({ to: '.', hash: id, replace: true, resetScroll: false, hashScrollIntoView: { behavior: 'smooth', block: 'start' } })
  }

  return (
    <>
      <div className="lg:hidden">
        <Select value={active} onValueChange={(v) => go(v as SectionId)}>
          <SelectTrigger className="h-10 w-full sm:w-72" aria-label="Settings section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SECTIONS.map(({ id, title, icon: Icon }) => (
              <SelectItem key={id} value={id}>
                <span className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  {title}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <nav aria-label="Settings sections" className="hidden flex-col gap-1 lg:flex">
        {SECTIONS.map(({ id, title, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={(e) => {
              e.preventDefault()
              go(id)
            }}
            aria-current={active === id ? 'true' : undefined}
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              'h-9 justify-start gap-2 whitespace-normal text-left',
              active === id ? 'bg-muted hover:bg-muted' : 'hover:bg-transparent hover:underline',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {title}
          </a>
        ))}
      </nav>
    </>
  )
}

/** Kit settings ContentSection: title and description, a separator, then the section body. */
function ContentSection({
  id,
  title,
  description,
  children,
}: {
  id: SectionId
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

function ProfileSection({ name }: { name: string }) {
  const router = useRouter()
  const [myName, setMyName] = useState(name)
  const [busy, setBusy] = useState(false)

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await updateProfileName({ data: { name: myName } })
      toast.success('Name saved')
      await router.invalidate()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ContentSection id="profile" title="Your profile" description="Shown on Leads, Follow-ups and Estimates you create.">
      <form onSubmit={saveName} className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Your full name" value={myName} onChange={(e) => setMyName(e.target.value)} placeholder="Your full name" required />
        <Button variant="outline" disabled={busy}>
          Save
        </Button>
      </form>
    </ContentSection>
  )
}

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC']
const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30'

function AdminSettings() {
  const { settings: s } = Route.useLoaderData()
  const settings = s!
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

      <EmailTemplatesSection calculatorTemplate={settings.estimateEmailTemplate} />
      <PhotoHomeSection />
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
