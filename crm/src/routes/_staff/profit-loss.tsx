import { Link, createFileRoute } from '@tanstack/react-router'
import { PageHeader, StatCard, StatGrid } from '#/components/page'
import { customerName, formatMoney } from '#/lib/customer-vocab'
import { marginPct } from '#/lib/qbo-vocab'
import { getProfitAndLoss } from '#/lib/qbo.functions'
import { cn } from '#/lib/utils'

// P&L (docs/adr/0006-quickbooks-sync.md): one year from the QuickBooks copy. Totals for the year, a running month by
// month table, then the Jobs completed that year with their profit and margin. Profit here takes every cost off,
// sorted or not, so it never looks better because sorting is behind.

export const Route = createFileRoute('/_staff/profit-loss')({
  validateSearch: (s: Record<string, unknown>): { year?: number } => {
    const y = Number(s.year)
    return { year: Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : undefined }
  },
  loaderDeps: ({ search }) => ({ year: search.year }),
  head: () => ({ meta: [{ title: 'P&L - Turner’s Decks CRM' }] }),
  loader: ({ deps }) => getProfitAndLoss({ data: { year: deps.year ?? new Date().getFullYear() } }),
  component: ProfitLossPage,
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = (c: number) => (c === 0 ? '–' : formatMoney(c))
const pct = (p: number | null) => (p === null ? '–' : `${p}%`)

function ProfitLossPage() {
  const { year, months, completedJobs, years } = Route.useLoaderData()
  const thisYear = new Date().getFullYear()
  const yearTabs = [...new Set([thisYear, year, ...years])].sort((a, b) => b - a)
  const sum = (k: keyof (typeof months)[number]) => months.reduce((a, m) => a + (m[k] as number), 0)
  const revenue = sum('revenueCents')
  const jobCosts = sum('jobCostCents')
  const overhead = sum('overheadCents')
  const unsorted = sum('unsortedCents')
  const paid = sum('paidCents')
  const costs = jobCosts + overhead + unsorted
  const profit = revenue - costs
  const lastMonth = year === thisYear ? new Date().getMonth() + 1 : 12
  let running = 0

  const jobTotal = completedJobs.reduce((a, j) => ({ revenue: a.revenue + j.revenueCents, cost: a.cost + j.costCents }), { revenue: 0, cost: 0 })

  return (
    <>
      <PageHeader title="P&L" description="Profit and loss from QuickBooks, by transaction date. Payments received are shown apart, never added twice." />
      <div className="space-y-6">
        <div role="tablist" aria-label="Year" className="flex gap-1">
          {yearTabs.map((y) => (
            <Link
              key={y}
              to="/profit-loss"
              search={{ year: y }}
              role="tab"
              aria-selected={y === year}
              className={cn('inline-flex h-8 items-center rounded-md border px-3 text-sm', y === year ? 'border-primary/40 bg-primary/5 font-semibold' : 'border-transparent text-muted-foreground hover:bg-muted')}
            >
              {y}
            </Link>
          ))}
        </div>

        <StatGrid>
          <StatCard label="Revenue" value={formatMoney(revenue) || '$0'} hint={`Invoiced${year === thisYear ? ' so far this year' : ` in ${year}`}; ${formatMoney(paid) || '$0'} paid`} />
          <StatCard
            label="Costs"
            value={formatMoney(costs) || '$0'}
            hint={`Jobs ${formatMoney(jobCosts) || '$0'} · Overhead ${formatMoney(overhead) || '$0'} · Not sorted ${formatMoney(unsorted) || '$0'}`}
          />
          <StatCard label="Profit" value={formatMoney(profit) || '$0'} hint={`${pct(revenue > 0 ? Math.round((100 * profit) / revenue) : null)} margin, after all costs`} />
          <StatCard label="Gross profit on Jobs" value={formatMoney(revenue - jobCosts) || '$0'} hint={`Revenue minus costs sorted onto Jobs (${pct(marginPct(revenue, jobCosts))})`} />
        </StatGrid>

        {unsorted > 0 && (
          <p className="text-sm text-muted-foreground">
            {formatMoney(unsorted)} of costs are not sorted yet. They are taken off Profit already; sorting them on{' '}
            <Link to="/transactions" className="underline">
              Transactions
            </Link>{' '}
            moves them into Job costs or Overhead.
          </p>
        )}

        <section aria-label="Month by month" className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Month</th>
                <th className="px-3 py-2 text-right font-medium">Revenue</th>
                <th className="px-3 py-2 text-right font-medium">Job costs</th>
                <th className="px-3 py-2 text-right font-medium">Overhead</th>
                <th className="px-3 py-2 text-right font-medium">Not sorted</th>
                <th className="px-3 py-2 text-right font-medium">Profit</th>
                <th className="px-3 py-2 text-right font-medium">Year to date</th>
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {months.slice(0, lastMonth).map((m, i) => {
                const p = m.revenueCents - m.jobCostCents - m.overheadCents - m.unsortedCents
                running += p
                return (
                  <tr key={m.month}>
                    <td className="px-3 py-1.5">{MONTHS[i]}</td>
                    <td className="px-3 py-1.5 text-right">{money(m.revenueCents)}</td>
                    <td className="px-3 py-1.5 text-right">{money(m.jobCostCents)}</td>
                    <td className="px-3 py-1.5 text-right">{money(m.overheadCents)}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{money(m.unsortedCents)}</td>
                    <td className={cn('px-3 py-1.5 text-right', p < 0 && 'text-destructive')}>{money(p)}</td>
                    <td className={cn('px-3 py-1.5 text-right font-medium', running < 0 && 'text-destructive')}>{money(running)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t font-semibold tabular-nums">
              <tr>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right">{money(revenue)}</td>
                <td className="px-3 py-2 text-right">{money(jobCosts)}</td>
                <td className="px-3 py-2 text-right">{money(overhead)}</td>
                <td className="px-3 py-2 text-right">{money(unsorted)}</td>
                <td className={cn('px-3 py-2 text-right', profit < 0 && 'text-destructive')}>{money(profit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </section>

        <section aria-label="Completed Jobs" className="space-y-2">
          <h2 className="text-sm font-semibold">Completed Jobs in {year}</h2>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Job</th>
                  <th className="px-3 py-2 text-left font-medium">Customer</th>
                  <th className="px-3 py-2 text-left font-medium">Finished</th>
                  <th className="px-3 py-2 text-right font-medium">Invoiced</th>
                  <th className="px-3 py-2 text-right font-medium">Costs</th>
                  <th className="px-3 py-2 text-right font-medium">Profit</th>
                  <th className="px-3 py-2 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {completedJobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      No Jobs marked done with a finish date in {year}.
                    </td>
                  </tr>
                ) : (
                  completedJobs.map((j) => {
                    const m = marginPct(j.revenueCents, j.costCents)
                    return (
                      <tr key={j.id}>
                        <td className="px-3 py-1.5">
                          <Link to="/jobs/$id" params={{ id: j.id }} className="font-medium hover:underline">
                            {j.name}
                          </Link>
                        </td>
                        <td className="px-3 py-1.5">{customerName({ firstName: j.first, lastName: j.last })}</td>
                        <td className="px-3 py-1.5 tabular-nums">{j.finishDate}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(j.revenueCents)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(j.costCents)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{m === null ? '–' : money(j.revenueCents - j.costCents)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{pct(m)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
              {completedJobs.length > 0 && (
                <tfoot className="border-t font-semibold tabular-nums">
                  <tr>
                    <td className="px-3 py-2" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right">{money(jobTotal.revenue)}</td>
                    <td className="px-3 py-2 text-right">{money(jobTotal.cost)}</td>
                    <td className="px-3 py-2 text-right">{money(jobTotal.revenue - jobTotal.cost)}</td>
                    <td className="px-3 py-2 text-right">{pct(marginPct(jobTotal.revenue, jobTotal.cost))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Profit and margin show once a Job has both invoices and costs on it. Our own crew's time is not in Job costs.</p>
        </section>
      </div>
    </>
  )
}
