import { Link, createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/page'
import { Card, CardContent } from '#/components/ui/card'
import { channelLabel, reportedSource } from '#/lib/lead-origin'
import { listPipeline } from '#/lib/leads.functions'
import { getCompanySettings } from '#/lib/settings.functions'
import { cn } from '#/lib/utils'

// Lead sources (docs/adr/0005-lead-sources.md): Leads by source, month by month for one year, with how many were won
// and the same months a year earlier. Two tables: Found us via (Google search, Business Profile, Facebook... or what the
// person told us) and Came in by (estimator, website form, text, call...). Months are in the company timezone.
// "Same months last year" compares like with like: for the current year, only the months so far.
export const Route = createFileRoute('/_staff/lead-sources')({
  validateSearch: (s: Record<string, unknown>): { year?: number } => {
    const y = Number(s.year)
    return { year: Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : undefined }
  },
  head: () => ({ meta: [{ title: 'Lead sources - Turner’s Decks CRM' }] }),
  loader: async () => {
    const [leads, settings] = await Promise.all([listPipeline(), getCompanySettings()])
    return { leads, timeZone: settings.timezone }
  },
  component: LeadSourcesPage,
})

type L = Awaited<ReturnType<typeof listPipeline>>[number]
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']

function LeadSourcesPage() {
  const { leads, timeZone } = Route.useLoaderData()
  const ym = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(new Date(d)).slice(0, 7)
  const now = ym(new Date())
  const thisYear = Number(now.slice(0, 4))
  const year = Route.useSearch().year ?? thisYear
  const years = [...new Set([thisYear, ...leads.map((l) => Number(ym(l.createdAt).slice(0, 4)))])].sort((a, b) => b - a)
  // Months that count for the comparison: all of a past year, Jan to now for the current one.
  const lastMonth = year === thisYear ? now.slice(5, 7) : '12'
  const inYear = (l: L, y: number) => {
    const m = ym(l.createdAt)
    return m.slice(0, 4) === String(y) && m.slice(5, 7) <= lastMonth
  }
  const rows = leads.filter((l) => ym(l.createdAt).startsWith(`${year}-`))
  const prior = leads.filter((l) => inYear(l, year - 1))
  const total = rows.filter((l) => inYear(l, year)).length

  return (
    <div>
      <PageHeader
        title="Lead sources"
        description="Where Leads came from, month by month, with how many were won. Texts and calls show as Unknown until someone fills in How they found us on the Lead."
      />
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div role="tablist" aria-label="Year" className="flex gap-1">
          {years.map((y) => (
            <Link
              key={y}
              to="/lead-sources"
              search={{ year: y }}
              role="tab"
              aria-selected={y === year}
              className={cn('inline-flex h-8 items-center rounded-md border px-3 text-sm', y === year ? 'border-primary/40 bg-primary/5 font-semibold' : 'border-transparent text-muted-foreground hover:bg-muted')}
            >
              {y}
            </Link>
          ))}
        </div>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{total}</span> Leads {year === thisYear ? 'so far this year' : `in ${year}`}
          {prior.length > 0 && (
            <>
              {' '}
              vs <span className="tabular-nums">{prior.length}</span> in the same months of {year - 1} <Change now={total} before={prior.length} />
            </>
          )}
        </p>
      </div>
      <div className="space-y-8">
        <SourceTable title="Found us via" rows={rows} prior={prior} keyOf={(l) => reportedSource(l)} year={year} ym={ym} />
        <SourceTable title="Came in by" rows={rows} prior={prior} keyOf={(l) => channelLabel(l.channel)} year={year} ym={ym} />
      </div>
    </div>
  )
}

function Change({ now, before }: { now: number; before: number }) {
  if (!before) return null
  const pct = Math.round((100 * (now - before)) / before)
  return <span className={cn('tabular-nums', pct > 0 ? 'text-success' : pct < 0 ? 'text-destructive' : 'text-muted-foreground')}>({pct > 0 ? '+' : ''}{pct}%)</span>
}

const monthLabel = (m: string) => new Date(`2000-${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })

function SourceTable({ title, rows, prior, keyOf, year, ym }: { title: string; rows: L[]; prior: L[]; keyOf: (l: L) => string; year: number; ym: (d: Date | string) => string }) {
  const groups = new Map<string, L[]>()
  for (const l of rows) groups.set(keyOf(l), [...(groups.get(keyOf(l)) ?? []), l])
  const priorBy = new Map<string, number>()
  for (const l of prior) priorBy.set(keyOf(l), (priorBy.get(keyOf(l)) ?? 0) + 1)
  for (const k of priorBy.keys()) if (!groups.has(k)) groups.set(k, [])
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (priorBy.get(b[0]) ?? 0) - (priorBy.get(a[0]) ?? 0))
  const cell = 'px-2.5 py-2 text-right tabular-nums'
  return (
    <section aria-labelledby={`t-${title}`}>
      <h2 id={`t-${title}`} className="mb-3 text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <Card className="overflow-x-auto shadow-xs">
        <CardContent className="p-0">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                {MONTHS.map((m) => (
                  <th key={m} className="px-2.5 py-2 text-right font-medium">
                    {monthLabel(m)}
                  </th>
                ))}
                <th className="px-2.5 py-2 text-right font-medium">{year}</th>
                <th className="px-2.5 py-2 text-right font-medium">Won</th>
                <th className="px-2.5 py-2 text-right font-medium">Won %</th>
                <th className="px-2.5 py-2 text-right font-medium" title="The same months a year earlier">
                  {year - 1}
                </th>
              </tr>
            </thead>
            <tbody>
              {ordered.length === 0 && (
                <tr>
                  <td colSpan={MONTHS.length + 5} className="px-3 py-6 text-center text-muted-foreground">
                    No Leads in {year}.
                  </td>
                </tr>
              )}
              {ordered.map(([key, ls]) => {
                const won = ls.filter((l) => l.stage === 'won').length
                return (
                  <tr key={key} data-source={key} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{key}</td>
                    {MONTHS.map((m) => (
                      <td key={m} className={cell}>
                        {ls.filter((l) => ym(l.createdAt) === `${year}-${m}`).length || ''}
                      </td>
                    ))}
                    <td className={`${cell} font-semibold`}>{ls.length || ''}</td>
                    <td className={cell}>{won || ''}</td>
                    <td className={cell}>{ls.length ? `${Math.round((100 * won) / ls.length)}%` : ''}</td>
                    <td className={cn(cell, 'text-muted-foreground')}>{priorBy.get(key) || ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  )
}
