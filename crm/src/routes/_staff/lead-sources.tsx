import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/page'
import { Card, CardContent } from '#/components/ui/card'
import { channelLabel, reportedSource } from '#/lib/lead-origin'
import { listPipeline } from '#/lib/leads.functions'
import { getCompanySettings } from '#/lib/settings.functions'

// Lead sources (docs/adr/0005-lead-sources.md): how many Leads came from where, by month, and how many were won.
// Two tables: Found us via (Google search, Business Profile, Facebook... or what the person told us) and Came in by
// (estimator, quote form, text, call...). Months are in the company timezone. Won counts the Leads from that period that
// are Won now.
export const Route = createFileRoute('/_staff/lead-sources')({
  head: () => ({ meta: [{ title: 'Lead sources - Turner’s Decks CRM' }] }),
  loader: async () => {
    const [leads, settings] = await Promise.all([listPipeline(), getCompanySettings()])
    return { leads, timeZone: settings.timezone }
  },
  component: LeadSourcesPage,
})

const MONTHS_SHOWN = 6

type L = Awaited<ReturnType<typeof listPipeline>>[number]

function LeadSourcesPage() {
  const { leads, timeZone } = Route.useLoaderData()
  const monthOf = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(new Date(d)).slice(0, 7)
  const now = new Date()
  const months: string[] = []
  for (let i = MONTHS_SHOWN - 1; i >= 0; i--) months.push(monthOf(new Date(now.getFullYear(), now.getMonth() - i, 15)))
  const yearAgo = monthOf(new Date(now.getFullYear(), now.getMonth() - 11, 15))
  const recent = leads.filter((l) => monthOf(l.createdAt) >= yearAgo)

  return (
    <div>
      <PageHeader
        title="Lead sources"
        description="Where Leads came from over the last 12 months. Texts and calls show as Unknown until someone fills in How they found us on the Lead."
      />
      <div className="space-y-8">
        <SourceTable title="Found us via" rows={recent} keyOf={(l) => reportedSource(l)} months={months} monthOf={monthOf} />
        <SourceTable title="Came in by" rows={recent} keyOf={(l) => channelLabel(l.channel)} months={months} monthOf={monthOf} />
      </div>
    </div>
  )
}

const label = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })

function SourceTable({ title, rows, keyOf, months, monthOf }: { title: string; rows: L[]; keyOf: (l: L) => string; months: string[]; monthOf: (d: Date | string) => string }) {
  const groups = new Map<string, L[]>()
  for (const l of rows) groups.set(keyOf(l), [...(groups.get(keyOf(l)) ?? []), l])
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  const cell = 'px-3 py-2 text-right tabular-nums'
  return (
    <section aria-labelledby={`t-${title}`}>
      <h2 id={`t-${title}`} className="mb-3 text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <Card className="overflow-x-auto shadow-xs">
        <CardContent className="p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                {months.map((m) => (
                  <th key={m} className="px-3 py-2 text-right font-medium">
                    {label(m)}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">12 months</th>
                <th className="px-3 py-2 text-right font-medium">Won</th>
                <th className="px-3 py-2 text-right font-medium">Won %</th>
              </tr>
            </thead>
            <tbody>
              {ordered.length === 0 && (
                <tr>
                  <td colSpan={months.length + 4} className="px-3 py-6 text-center text-muted-foreground">
                    No Leads in the last 12 months.
                  </td>
                </tr>
              )}
              {ordered.map(([key, ls]) => {
                const won = ls.filter((l) => l.stage === 'won').length
                return (
                  <tr key={key} data-source={key} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{key}</td>
                    {months.map((m) => (
                      <td key={m} className={cell}>
                        {ls.filter((l) => monthOf(l.createdAt) === m).length || ''}
                      </td>
                    ))}
                    <td className={`${cell} font-semibold`}>{ls.length}</td>
                    <td className={cell}>{won || ''}</td>
                    <td className={cell}>{ls.length ? `${Math.round((100 * won) / ls.length)}%` : ''}</td>
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
