import { Link } from '@tanstack/react-router'
import { Receipt } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatMoney } from '#/lib/customer-vocab'
import { QBO_ENTITY_LABELS, type QboEntity } from '#/lib/qbo-vocab'
import { getJobFinancials } from '#/lib/qbo.functions'

// A Job's money from QuickBooks (docs/adr/0006-quickbooks-sync.md): invoiced, costs (net of credits), profit, margin
// and paid, with the transactions on it. Loaded after the page.

type Fin = Awaited<ReturnType<typeof getJobFinancials>>

export function JobMoneyPanel({ jobId }: { jobId: string }) {
  const [fin, setFin] = useState<Fin | null>(null)
  useEffect(() => {
    getJobFinancials({ data: { jobId } }).then(setFin, () => setFin(null))
  }, [jobId])
  if (!fin) return null
  const t = fin.totals
  const stat = (label: string, cents: number) => (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{formatMoney(cents) || '$0'}</p>
    </div>
  )
  return (
    <section aria-label="QuickBooks" className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Receipt className="size-4 text-muted-foreground" />
        From QuickBooks
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {stat('Invoiced', t.revenueCents)}
        {stat('Costs', t.costCents)}
        {stat('Profit', t.profitCents)}
        <div>
          <p className="text-xs text-muted-foreground">Margin</p>
          <p className="text-lg font-semibold tabular-nums">{t.marginPct === null ? '–' : `${t.marginPct}%`}</p>
        </div>
        {stat('Paid', t.paidCents)}
      </div>
      {t.crewOutsideCents > 0 && (
        <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/40 p-3 sm:grid-cols-5">
          {stat('Crew paid outside QuickBooks', t.crewOutsideCents)}
          {stat('All-in costs', t.allInCostCents)}
          {stat('All-in profit', t.allInProfitCents)}
          <div>
            <p className="text-xs text-muted-foreground">All-in margin</p>
            <p className="text-lg font-semibold tabular-nums">{t.allInMarginPct === null ? '–' : `${t.allInMarginPct}%`}</p>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Profit is invoiced minus the costs sorted onto this Job. Crew paid through QuickBooks is in those costs; crew paid another way (cash) is added once in All-in, after it's verified under Crew time.
        {t.marginPct === null && ' Margin shows once the Job has both invoices and costs.'}
      </p>
      {fin.transactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No transactions on this Job yet. Sort them on{' '}
          <Link to="/transactions" className="underline">
            Transactions
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {fin.transactions.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate">
                <span className="tabular-nums text-muted-foreground">{r.txnDate}</span> · {QBO_ENTITY_LABELS[r.entity as QboEntity] ?? r.entity} · {r.partyName}
              </span>
              <span className="shrink-0 tabular-nums">{formatMoney(r.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
