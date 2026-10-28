import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Plus, RefreshCw, Rocket, Save, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { PageHeader } from '#/components/page'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Separator } from '#/components/ui/separator'
import { Textarea } from '#/components/ui/textarea'
import { formatWhen } from '#/lib/dates'
import { errorDetails, errorMessage } from '#/lib/errors'
import { getEstimatorSettings, publishEstimatorDraft, saveEstimatorDraft } from '#/lib/estimator-settings.functions'
import { type EstimatorDocument, type EstimatorOption, type EstimatorQuestion, QUESTION_KIND, type QuestionKey, hasOptions } from '#/lib/estimator/document'
import { optionValueFor } from '#/lib/estimator/option-value'
import { STEPS } from '#/lib/estimator/relevance'
import { getCompanySettings } from '#/lib/settings.functions'

// Estimator settings (FLW-203, ADR 0003): a form over the draft document, grouped by the estimator's steps. Every
// Staff member can look; only admins edit (inputs disabled for staff-role Staff, as on /settings), save the draft and
// publish it. Saves carry the draft revision they were made from: a stale save (409) offers a reload. Publishing is
// only offered for a saved draft, so what goes live is exactly what was reviewed.
// `settings_` keeps this page out of the /settings layout (that page has no Outlet).
export const Route = createFileRoute('/_staff/settings_/estimator')({
  head: () => ({
    meta: [{ title: 'Estimator settings - Turner’s Decks CRM' }, { name: 'description', content: 'Prices, questions and wording for the online estimator.' }],
  }),
  loader: async () => {
    const [settings, company] = await Promise.all([getEstimatorSettings(), getCompanySettings()])
    return { settings, timeZone: company.timezone }
  },
  component: EstimatorSettingsPage,
})

type Settings = Awaited<ReturnType<typeof getEstimatorSettings>>
type Rules = Settings['rules']
type FieldErrors = Record<string, string>

// A fresh editor for each saved revision, so a save or a reload starts from what the server holds.
function EstimatorSettingsPage() {
  const { settings } = Route.useLoaderData()
  return <EstimatorEditor key={settings.revision} />
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30'

// Each question once, on the first step that asks it (railing style can also be asked on the stairs step).
const STEP_QUESTIONS: QuestionKey[][] = (() => {
  const seen = new Set<QuestionKey>()
  return STEPS.map((items) =>
    items.flatMap(({ key }) => {
      if (seen.has(key)) return []
      seen.add(key)
      return [key]
    }),
  )
})()

const KIND_LABELS: Record<string, string> = {
  choice: 'Homeowner picks one',
  multi: 'Homeowner picks any',
  sections: 'Deck size (width × depth)',
  zip: 'ZIP code',
  number: 'Number',
  toggle: 'Yes or no',
}

const PRICE_FIELD_LABELS: Record<string, string> = {
  newPerSqft: 'New deck, $ per sq ft',
  redeckPerSqft: 'Redeck, $ per sq ft',
  multiplier: 'Price multiplier (1 = no change)',
  skirtingHeightFt: 'Skirting height (ft)',
  share: 'Share of the deck edge railed (%)',
  perLf: '$ per foot',
  lf: 'Wall length (ft)',
  base: 'Price per staircase ($)',
  risers: 'Risers per staircase',
  railLfPerSide: 'Stair rail per side (ft)',
  price: 'Price ($)',
  pct: 'Added to the deck price (%)',
  perSqft: '$ per sq ft of skirting',
}

const PRICE_LABELS: { key: keyof EstimatorDocument['prices']; label: string; percent?: boolean }[] = [
  { key: 'minimumProjectPrice', label: 'Minimum project price ($)' },
  { key: 'markupPercent', label: 'Markup on every estimate (%)', percent: true },
  { key: 'permitAllowance', label: 'Permit allowance ($)' },
  { key: 'gateEach', label: 'Each gate ($)' },
  { key: 'closedRiserPerRiser', label: 'Closed risers, per riser ($)' },
  { key: 'landingSqft', label: 'Landing size (sq ft)' },
  { key: 'landingStructureFactor', label: 'Landing structure multiplier' },
  { key: 'landingRailLf', label: 'Railing per landing (ft)' },
  { key: 'skirtingAccessDoor', label: 'Skirting access door ($)' },
  { key: 'skirtingPartialShare', label: 'Partial skirting covers (%)', percent: true },
  { key: 'privacyWallPerLf', label: 'Privacy wall, $ per foot' },
  { key: 'stairOpeningLf', label: 'Railing gap per staircase (ft)' },
  { key: 'expansionIntegration', label: 'Tie-in cost for expansions (%)', percent: true },
  { key: 'redeckFramingContingency', label: 'Framing allowance on redecks (%)', percent: true },
]

const RANGE_LABELS: { key: keyof EstimatorDocument['ranges']; label: string; help: string }[] = [
  { key: 'standard', label: 'Standard', help: 'Most estimates.' },
  { key: 'uncertain', label: 'Several “Not sure” answers', help: 'Two or more “Not sure” answers widen the range.' },
  { key: 'review', label: 'Needs site review', help: 'Any site-review flag uses this range.' },
]

const DISCLAIMER_LABELS: { key: keyof EstimatorDocument['copy']['disclaimers']; label: string }[] = [
  { key: 'primary', label: 'Main disclaimer' },
  { key: 'redeck', label: 'Redeck' },
  { key: 'permit', label: 'Permits' },
  { key: 'material', label: 'Materials' },
  { key: 'homeownerDemo', label: 'Homeowner removes the old deck' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'neighbors', label: 'Neighbors' },
  { key: 'townhouseHoa', label: 'Townhouse or HOA' },
]

const SERVICE_AREA_COPY: { key: keyof EstimatorDocument['copy']['serviceArea']; label: string }[] = [
  { key: 'primary', label: 'In the service area' },
  { key: 'edge', label: 'Edge of the service area' },
  { key: 'outside', label: 'Outside the service area' },
]

const blankToUndefined = (s: string) => (s.trim() ? s : undefined)

/** Text state for an input whose value is parsed into the document, so half-typed text ("19", "4,") survives. */
function useSyncedText<T>(value: T, format: (v: T) => string, parse: (s: string) => T) {
  const [text, setText] = useState(() => format(value))
  const valueKey = JSON.stringify(value)
  useEffect(() => {
    if (JSON.stringify(parse(text)) !== valueKey) setText(format(value))
    // Only an outside change of the value resets the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKey])
  return [text, setText] as const
}

function FieldError({ message }: { message?: string | undefined }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null
}

function NumberField({
  id,
  label,
  value,
  onChange,
  percent = false,
  error,
}: {
  id: string
  label: string
  value: number | undefined
  onChange: (n: number) => void
  percent?: boolean
  error?: string | undefined
}) {
  const format = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? String(percent ? Number((v * 100).toFixed(4)) : v) : '')
  const parse = (t: string) => (t.trim() === '' ? Number.NaN : percent ? Number(t) / 100 : Number(t))
  const [text, setText] = useSyncedText<number | undefined>(value, format, parse)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setText(e.target.value)
          onChange(parse(e.target.value))
        }}
      />
      <FieldError message={error} />
    </div>
  )
}

/** A list edited as text: ZIP prefixes separated by commas, or one line per item. */
function ListField({
  id,
  label,
  value,
  onChange,
  lines = false,
  help,
  error,
}: {
  id: string
  label: string
  value: string[]
  onChange: (v: string[]) => void
  lines?: boolean
  help?: string
  error?: string | undefined
}) {
  const format = (v: string[]) => v.join(lines ? '\n' : ', ')
  const parse = (t: string) => (lines ? t.split('\n') : t.split(/[\s,]+/)).map((s) => s.trim()).filter(Boolean)
  const [text, setText] = useSyncedText(value, format, parse)
  const change = (t: string) => {
    setText(t)
    onChange(parse(t))
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {lines ? (
        <Textarea id={id} rows={Math.min(12, Math.max(3, value.length + 1))} value={text} onChange={(e) => change(e.target.value)} />
      ) : (
        <Input id={id} value={text} onChange={(e) => change(e.target.value)} />
      )}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      <FieldError message={error} />
    </div>
  )
}

/** Kit settings ContentSection, as on /settings: title and description, a separator, then the body. */
function ContentSection({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
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

function EstimatorEditor() {
  const { settings: s, timeZone } = Route.useLoaderData()
  const { staff } = Route.useRouteContext()
  const isAdmin = staff.role === 'admin'
  const router = useRouter()
  const [doc, setDoc] = useState<EstimatorDocument>(s.draft)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [stale, setStale] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'publish' | 'reload' | null>(null)
  const dirty = useMemo(() => JSON.stringify(doc) !== JSON.stringify(s.draft), [doc, s.draft])

  /** Edits a copy of the document. `structural` changes (add, remove, reorder) clear errors whose indexes moved. */
  function edit(change: (d: EstimatorDocument) => void, structural = false) {
    setDoc((prev) => {
      const next = structuredClone(prev)
      change(next)
      return next
    })
    if (structural) setErrors({})
  }

  const errorAt = (path: string) => errors[path]
  const errorUnder = (prefix: string) => Object.entries(errors).find(([k]) => k === prefix || k.startsWith(`${prefix}.`))?.[1]
  const errorCount = Object.keys(errors).length
  // Messages with no field of their own on this page.
  const looseErrors = Object.entries(errors).filter(([k]) => k === '' || k === 'questions').map(([, m]) => m)

  async function save() {
    setBusy('save')
    setStale(null)
    try {
      await saveEstimatorDraft({ data: { document: doc, revision: s.revision } })
      setErrors({})
      toast.success('Draft saved. Homeowners still see the live version until you publish.')
      await router.invalidate({ sync: true })
    } catch (error) {
      if (error instanceof Response && error.status === 409) {
        setStale(await errorMessage(error))
      } else {
        const details = await errorDetails(error)
        setErrors(details.fieldErrors)
        toast.error(details.message)
      }
    } finally {
      setBusy(null)
    }
  }

  async function publish() {
    setBusy('publish')
    try {
      const { version } = await publishEstimatorDraft({ data: { revision: s.revision } })
      toast.success(`Published version ${version} is live.`)
      await router.invalidate({ sync: true })
    } catch (error) {
      if (error instanceof Response && error.status === 409) {
        setStale(await errorMessage(error))
      } else {
        const details = await errorDetails(error)
        setErrors(details.fieldErrors)
        toast.error(details.message)
      }
    } finally {
      setBusy(null)
    }
  }

  async function reload() {
    setBusy('reload')
    try {
      await router.invalidate({ sync: true })
      setStale(null)
    } finally {
      setBusy(null)
    }
  }

  const questionIndex = (key: QuestionKey) => doc.questions.findIndex((q) => q.key === key)

  return (
    <div>
      <PageHeader
        title="Estimator settings"
        description={
          isAdmin
            ? 'Prices, questions and wording for the online estimator. Save a draft, then publish it when it is ready.'
            : 'What the online estimator asks and charges. Only an admin can change it.'
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm" data-slot="live-version">
        <span>
          <span className="font-semibold">Live: Published version {s.live.version}</span>
          <span className="text-muted-foreground">
            {' '}
            · published {formatWhen(s.live.publishedAt, timeZone)}
            {s.live.publishedBy ? ` by ${s.live.publishedBy}` : ''}
          </span>
        </span>
        {s.unpublished && <Badge variant="warning">Unpublished changes</Badge>}
        <span className="text-muted-foreground">Draft last saved {formatWhen(s.draftUpdatedAt, timeZone)}</span>
      </div>

      {stale && (
        <Alert variant="destructive" className="mb-6">
          <TriangleAlert className="size-4" />
          <AlertTitle>The settings changed</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{stale}</p>
            <Button size="sm" variant="outline" onClick={reload} disabled={busy !== null}>
              <RefreshCw />
              Reload
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {errorCount > 0 && (
        <Alert variant="destructive" className="mb-6" data-slot="error-summary">
          <TriangleAlert className="size-4" />
          <AlertTitle>{errorCount === 1 ? '1 field needs fixing' : `${errorCount} fields need fixing`}</AlertTitle>
          <AlertDescription>
            <p>Look for the messages in red below. Nothing was saved.</p>
            {looseErrors.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {looseErrors.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      <fieldset disabled={!isAdmin || busy !== null} className="min-w-0 max-w-4xl space-y-10">
        {STEP_QUESTIONS.map((keys, step) => (
          <ContentSection key={step} id={`step-${step + 1}`} title={`Step ${step + 1}: ${doc.copy.steps[step] ?? ''}`}>
            <div className="space-y-4">
              {keys.map((key) => {
                const qi = questionIndex(key)
                const q = doc.questions[qi]
                if (!q) return null
                return (
                  <QuestionCard
                    key={key}
                    q={q}
                    qi={qi}
                    rules={s.rules}
                    isAdmin={isAdmin}
                    errorAt={errorAt}
                    edit={(change, structural) => edit((d) => change(d.questions[qi]!), structural)}
                  />
                )
              })}
            </div>
          </ContentSection>
        ))}

        <ContentSection id="prices" title="Other prices" description="Prices that do not belong to a single answer.">
          <Card className="shadow-xs">
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
              {PRICE_LABELS.map(({ key, label, percent }) => (
                <NumberField
                  key={key}
                  id={`prices-${key}`}
                  label={label}
                  percent={percent}
                  value={doc.prices[key]}
                  onChange={(n) => edit((d) => void (d.prices[key] = n))}
                  error={errorAt(`prices.${key}`)}
                />
              ))}
            </CardContent>
          </Card>
        </ContentSection>

        <ContentSection
          id="ranges"
          title="Price ranges"
          description="How far below and above the middle price the Homeowner’s range goes. 90% and 110% turn $40,000 into $36,000 to $44,000."
        >
          <Card className="shadow-xs">
            <CardContent className="space-y-4 p-4 sm:p-6">
              {RANGE_LABELS.map(({ key, label, help }) => (
                <div key={key} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-start">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{help}</p>
                  </div>
                  {([0, 1] as const).map((end) => (
                    <NumberField
                      key={end}
                      id={`ranges-${key}-${end}`}
                      label={end === 0 ? 'Low end (%)' : 'High end (%)'}
                      percent
                      value={doc.ranges[key][end]}
                      onChange={(n) => edit((d) => void (d.ranges[key][end] = n))}
                      error={errorAt(`ranges.${key}.${end}`) ?? errorAt(`ranges.${key}`)}
                    />
                  ))}
                </div>
              ))}
              <FieldError message={errorAt('ranges')} />
            </CardContent>
          </Card>
        </ContentSection>

        <ContentSection
          id="service-area"
          title="Service area"
          description="The first three digits of the ZIP codes you serve. Outside both lists, the estimate is flagged for site review."
        >
          <Card className="shadow-xs">
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
              <ListField
                id="primaryZipPrefixes"
                label="Service area ZIP prefixes"
                value={doc.serviceArea.primaryZipPrefixes}
                onChange={(v) => edit((d) => void (d.serviceArea.primaryZipPrefixes = v))}
                help="Separate with commas, for example 193, 194."
                error={errorUnder('serviceArea.primaryZipPrefixes')}
              />
              <ListField
                id="edgeZipPrefixes"
                label="Edge of the service area ZIP prefixes"
                value={doc.serviceArea.edgeZipPrefixes}
                onChange={(v) => edit((d) => void (d.serviceArea.edgeZipPrefixes = v))}
                help="Separate with commas."
                error={errorUnder('serviceArea.edgeZipPrefixes')}
              />
            </CardContent>
          </Card>
        </ContentSection>

        <ContentSection id="copy" title="Wording" description="What the estimator says around the questions.">
          <Card className="shadow-xs">
            <CardContent className="space-y-6 p-4 sm:p-6">
              <div className="space-y-2">
                <p className="text-sm font-medium">Step titles</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {doc.copy.steps.map((title, i) => (
                    <div key={i} className="space-y-1.5">
                      <Label htmlFor={`copy-steps-${i}`} className="text-xs">
                        Step {i + 1}
                      </Label>
                      <Input id={`copy-steps-${i}`} value={title} onChange={(e) => edit((d) => void (d.copy.steps[i] = e.target.value))} />
                      <FieldError message={errorAt(`copy.steps.${i}`)} />
                    </div>
                  ))}
                </div>
              </div>
              <TextField id="copy-intro" label="Introduction" value={doc.copy.intro} onChange={(v) => edit((d) => void (d.copy.intro = v))} error={errorAt('copy.intro')} />
              <div className="space-y-4">
                <p className="text-sm font-medium">Service area messages</p>
                {SERVICE_AREA_COPY.map(({ key, label }) => (
                  <TextField
                    key={key}
                    id={`copy-serviceArea-${key}`}
                    label={label}
                    value={doc.copy.serviceArea[key]}
                    onChange={(v) => edit((d) => void (d.copy.serviceArea[key] = v))}
                    error={errorAt(`copy.serviceArea.${key}`)}
                  />
                ))}
              </div>
              <div className="space-y-4">
                <p className="text-sm font-medium">Disclaimers</p>
                {DISCLAIMER_LABELS.map(({ key, label }) => (
                  <TextField
                    key={key}
                    id={`copy-disclaimers-${key}`}
                    label={label}
                    value={doc.copy.disclaimers[key]}
                    onChange={(v) => edit((d) => void (d.copy.disclaimers[key] = v))}
                    error={errorAt(`copy.disclaimers.${key}`)}
                  />
                ))}
              </div>
              <ListField
                id="copy-included"
                lines
                label="What the estimate includes"
                help="One item per line."
                value={doc.copy.included}
                onChange={(v) => edit((d) => void (d.copy.included = v))}
                error={errorUnder('copy.included')}
              />
              <ListField
                id="copy-priceFactors"
                lines
                label="What can change the final price"
                help="One item per line."
                value={doc.copy.priceFactors}
                onChange={(v) => edit((d) => void (d.copy.priceFactors = v))}
                error={errorUnder('copy.priceFactors')}
              />
            </CardContent>
          </Card>
        </ContentSection>
      </fieldset>

      {isAdmin && (
        // One Save and Publish for the whole page, kept in reach while scrolling (as on /settings).
        <div className="sticky bottom-0 z-10 -mx-4 mt-10 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:px-0">
          <p className="mr-auto text-sm text-muted-foreground">
            {dirty ? 'You have unsaved changes.' : s.unpublished ? 'Draft saved. Publish it when it is ready.' : 'Everything here is live.'}
          </p>
          <Button variant="outline" onClick={save} disabled={!dirty || busy !== null} className="max-sm:flex-1">
            <Save />
            {busy === 'save' ? 'Saving…' : 'Save draft'}
          </Button>
          <ConfirmDialog
            trigger={
              <Button disabled={dirty || !s.unpublished || busy !== null} title={dirty ? 'Save the draft first' : undefined} className="max-sm:flex-1">
                <Rocket />
                Publish
              </Button>
            }
            title={`Publish as version ${s.live.version + 1}?`}
            description={
              <div className="space-y-2">
                <p>Homeowners using the online estimator get these prices, questions and wording right away.</p>
                <p>Leads that already have an Estimate snapshot keep the price they were shown.</p>
              </div>
            }
            confirmLabel="Publish now"
            pending={busy === 'publish'}
            onConfirm={publish}
          />
        </div>
      )}
    </div>
  )
}

function TextField({ id, label, value, onChange, error }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string | undefined }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      <FieldError message={error} />
    </div>
  )
}

function QuestionCard({
  q,
  qi,
  rules,
  isAdmin,
  errorAt,
  edit,
}: {
  q: EstimatorQuestion
  qi: number
  rules: Rules
  isAdmin: boolean
  errorAt: (path: string) => string | undefined
  edit: (change: (q: EstimatorQuestion) => void, structural?: boolean) => void
}) {
  const [newLabel, setNewLabel] = useState('')
  const kind = QUESTION_KIND[q.key]
  const at = `questions.${qi}`
  const dataDriven = rules.dataDriven.includes(q.key)
  const fields = Object.entries(rules.priceFields[q.key] ?? {})
  const required = rules.requiredValues[q.key] ?? []
  const seedValues = rules.seedValues[q.key] ?? []
  const options = q.options ?? []

  function addOption() {
    const label = newLabel.trim()
    if (!label) return
    const option: EstimatorOption = {
      value: optionValueFor(label, options.map((o) => o.value)),
      label,
      enabled: true,
      price: Object.fromEntries(fields.map(([f]) => [f, 0])),
    }
    edit((x) => void (x.options = [...(x.options ?? []), option]), true)
    setNewLabel('')
  }

  return (
    <Card className="shadow-xs" id={`question-${q.key}`} data-question={q.key}>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">{q.label || 'Untitled question'}</h3>
          <span className="text-xs text-muted-foreground">{KIND_LABELS[kind]}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${q.key}-label`}>Question</Label>
            <Input id={`${q.key}-label`} value={q.label} onChange={(e) => edit((x) => void (x.label = e.target.value))} />
            <FieldError message={errorAt(`${at}.label`)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${q.key}-help`}>Help text</Label>
            <Textarea
              id={`${q.key}-help`}
              rows={2}
              value={q.help ?? ''}
              placeholder="Optional. Shown under the question."
              onChange={(e) => edit((x) => void (x.help = blankToUndefined(e.target.value)))}
            />
            <FieldError message={errorAt(`${at}.help`)} />
          </div>
          {kind === 'choice' && (
            <div className="space-y-1.5">
              <Label htmlFor={`${q.key}-default`}>Default answer</Label>
              <select
                id={`${q.key}-default`}
                className={selectClass}
                value={q.default ?? ''}
                onChange={(e) => edit((x) => void (x.default = e.target.value || null))}
              >
                <option value="">None (the Homeowner must choose)</option>
                {options
                  .filter((o) => o.enabled || o.value === q.default)
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </select>
              <FieldError message={errorAt(`${at}.default`)} />
            </div>
          )}
        </div>

        {hasOptions(q.key) && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Answers to choose from</p>
              <p className="text-xs text-muted-foreground">
                {dataDriven
                  ? 'You can rename, reorder, reprice and turn these off, and add your own.'
                  : 'You can rename, reorder and turn these off. The estimator’s math depends on them, so they cannot be added or removed.'}
              </p>
              <FieldError message={errorAt(`${at}.options`)} />
            </div>
            <ol className="space-y-2">
              {options.map((o, oi) => {
                const oat = `${at}.options.${oi}`
                const id = `${q.key}-${oi}`
                const isRequired = required.includes(o.value)
                const deletable = dataDriven && !isRequired && !seedValues.includes(o.value)
                const setOption = (change: (o: EstimatorOption) => void) => edit((x) => change(x.options![oi]!))
                const move = (by: number) =>
                  edit((x) => {
                    const list = x.options!
                    const [item] = list.splice(oi, 1)
                    list.splice(oi + by, 0, item!)
                  }, true)
                return (
                  <li key={o.value} className="space-y-3 rounded-lg border p-3" data-option={o.value}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox
                        id={`${id}-enabled`}
                        checked={o.enabled}
                        onCheckedChange={(c) => setOption((x) => void (x.enabled = c === true))}
                      />
                      <Label htmlFor={`${id}-enabled`} className="text-sm">
                        Offered
                      </Label>
                      {!o.enabled && <Badge variant="secondary">Off</Badge>}
                      {isRequired && (
                        <Badge variant="outline" title="The estimator’s math uses this answer, so it cannot be removed.">
                          Required
                        </Badge>
                      )}
                      {isAdmin && (
                        <div className="ml-auto flex items-center gap-1">
                          <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Move “${o.label}” up`} disabled={oi === 0} onClick={() => move(-1)}>
                            <ArrowUp />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label={`Move “${o.label}” down`}
                            disabled={oi === options.length - 1}
                            onClick={() => move(1)}
                          >
                            <ArrowDown />
                          </Button>
                          {deletable && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-8 text-destructive hover:text-destructive"
                              aria-label={`Delete “${o.label}”`}
                              onClick={() =>
                                edit((x) => {
                                  x.options!.splice(oi, 1)
                                  if (x.default === o.value) x.default = null
                                }, true)
                              }
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`${id}-label`} className="text-xs">
                          Answer
                        </Label>
                        <Input id={`${id}-label`} value={o.label} onChange={(e) => setOption((x) => void (x.label = e.target.value))} />
                        <FieldError message={errorAt(`${oat}.label`) ?? errorAt(`${oat}.value`)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`${id}-hint`} className="text-xs">
                          Hint
                        </Label>
                        <Input
                          id={`${id}-hint`}
                          value={o.hint ?? ''}
                          placeholder="Optional"
                          onChange={(e) => setOption((x) => void (x.hint = blankToUndefined(e.target.value)))}
                        />
                        <FieldError message={errorAt(`${oat}.hint`)} />
                      </div>
                      {fields.map(([field, bound]) => (
                        <NumberField
                          key={field}
                          id={`${id}-price-${field}`}
                          label={PRICE_FIELD_LABELS[field] ?? field}
                          percent={bound === 'percent' || bound === 'share'}
                          value={o.price[field]}
                          onChange={(n) => setOption((x) => void (x.price[field] = n))}
                          error={errorAt(`${oat}.price.${field}`)}
                        />
                      ))}
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor={`${id}-flag`} className="text-xs">
                          Site-review flag
                        </Label>
                        <Input
                          id={`${id}-flag`}
                          value={o.reviewFlag ?? ''}
                          placeholder="Leave blank if this answer needs no site review"
                          onChange={(e) => setOption((x) => void (x.reviewFlag = blankToUndefined(e.target.value)))}
                        />
                        <FieldError message={errorAt(`${oat}.reviewFlag`)} />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
            {isAdmin && dataDriven && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label={`New answer for “${q.label}”`}
                  placeholder="New answer, for example Trex Transcend"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addOption()
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addOption} disabled={!newLabel.trim() || options.length >= 40}>
                  <Plus />
                  Add an option
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
