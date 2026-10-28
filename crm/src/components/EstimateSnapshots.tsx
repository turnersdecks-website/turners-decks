import { Calculator, TriangleAlert } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { Badge } from '#/components/ui/badge'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { formatWhen } from '#/lib/dates'
import type { EstimateSnapshotView } from '#/lib/estimate-snapshots.functions'
import type { QuestionKey } from '#/lib/estimator/document'
import { STEPS, relevantKeys } from '#/lib/estimator/relevance'

// The Lead page's Estimate tab (FLW-203): each Estimate snapshot as the Homeowner saw it. Labels come from the
// snapshot's own questions (the Published version they answered), never from today's Estimator settings.

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const LINE_ITEM_LABELS: Record<string, string> = {
  platform: 'Deck platform',
  railing: 'Railings',
  stairs: 'Stairs',
  landing: 'Landings',
  demolition: 'Demolition',
  fascia: 'Fascia',
  pattern: 'Decking pattern',
  skirting: 'Skirting',
  gates: 'Gates',
  privacy: 'Privacy wall',
  lighting: 'Lighting',
  features: 'Extra features',
  permit: 'Permit allowance',
  framing: 'Redeck framing allowance',
}

const SERVICE_AREA_LABELS: Record<string, string> = {
  primary: 'In the service area',
  edge: 'Edge of the service area',
  outside: 'Outside the service area',
}

// Each question once, in the order the estimator asks them.
const QUESTION_ORDER: QuestionKey[] = [...new Set(STEPS.flat().map((i) => i.key))]

type Snapshot = EstimateSnapshotView

/** The Homeowner's answer in words, using the labels of the version they answered. */
export function answerText(s: Snapshot, key: string): string {
  const q = s.questions[key]
  const v = s.answers[key]
  const label = (value: unknown) => q?.options?.find((o) => o.value === value)?.label ?? String(value)
  if (v === undefined || v === null) return key === 'railingLf' ? 'Not given (estimated from the deck size)' : 'Not answered'
  switch (q?.kind) {
    case 'choice':
      return label(v)
    case 'multi':
      return Array.isArray(v) && v.length ? v.map(label).join(', ') : 'None'
    case 'sections': {
      const parts = Array.isArray(v) ? (v as { width: number; depth: number }[]).map((x) => `${x.width} × ${x.depth}`) : []
      return parts.length ? `${parts[0]} ft${parts.length > 1 ? ` (+ ${parts.slice(1).join(', ')})` : ''}` : 'Not answered'
    }
    case 'number':
      return `${String(v)} ft`
    case 'toggle':
      return v === true ? 'Yes' : 'No'
    default:
      return String(v)
  }
}

export function EstimateSnapshots({ snapshots, timeZone }: { snapshots: Snapshot[]; timeZone: string }) {
  if (!snapshots.length) {
    return (
      <EmptyState
        bordered
        icon={Calculator}
        title="No Estimate snapshots yet."
        description="When this Homeowner uses the online estimator, their answers and price range show up here."
      />
    )
  }
  return (
    <div className="space-y-6">
      {snapshots.map((s) => (
        <SnapshotCard key={s.id} s={s} timeZone={timeZone} />
      ))}
    </div>
  )
}

function SnapshotCard({ s, timeZone }: { s: Snapshot; timeZone: string }) {
  const shown = relevantKeys(s.answers as Parameters<typeof relevantKeys>[0])
  const keys = QUESTION_ORDER.filter((k) => shown.has(k) && s.questions[k])
  const items = Object.entries(s.lineItems).filter(([, n]) => Math.round(n) !== 0)

  return (
    <article className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs" data-slot="estimate-snapshot">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Calculator className="size-4" aria-hidden />
          </span>
          <h2 className="text-sm font-semibold">{formatWhen(s.createdAt, timeZone)}</h2>
        </div>
        <span className="text-xs text-muted-foreground">Published version {s.version}</span>
      </header>

      <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Range the Homeowner saw</p>
            <p className="text-2xl font-bold tabular-nums">
              {usd(s.low)} – {usd(s.high)}
            </p>
            <p className="text-sm text-muted-foreground">
              Midpoint (internal, not shown to the Homeowner): <span className="font-medium text-foreground tabular-nums">{usd(s.mid)}</span>
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="secondary">{SERVICE_AREA_LABELS[s.serviceArea] ?? s.serviceArea}</Badge>
              <Badge variant="secondary">{Math.round(s.sqft)} sq ft</Badge>
              {s.railingLf > 0 && <Badge variant="secondary">{s.railingLf} ft of railing</Badge>}
              {s.belowMinimum && <Badge variant="warning">Raised to the minimum project price</Badge>}
            </div>
          </div>

          <section aria-label="Site-review flags">
            {s.flags.length ? (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <TriangleAlert className="size-4" aria-hidden />
                  Needs site review
                </h3>
                <ul className="mt-1 list-disc space-y-0.5 pl-6 text-sm">
                  {s.flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No site-review flags.</p>
            )}
          </section>

          <section aria-label="Answers">
            <h3 className="mb-2 text-sm font-semibold">Answers</h3>
            <dl className="divide-y rounded-lg border text-sm">
              {keys.map((k) => (
                <div key={k} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-muted-foreground">{s.questions[k]!.label}</dt>
                  <dd className="min-w-0 break-words">
                    {answerText(s, k)}
                    {s.defaulted.includes(k) && <span className="text-muted-foreground"> (default)</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <section aria-label="Line items" className="min-w-0 self-start">
          <h3 className="mb-2 text-sm font-semibold">Line items</h3>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(([k, n]) => (
                  <TableRow key={k}>
                    <TableCell>{LINE_ITEM_LABELS[k] ?? k}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(n)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Midpoint</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(s.mid)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">The midpoint includes any markup and the minimum project price.</p>
        </section>
      </div>
    </article>
  )
}
