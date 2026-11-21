import { Link } from '@tanstack/react-router'
import { ChevronDown, Receipt } from 'lucide-react'
import { useEffect, useState } from 'react'
import { StatCard, StatGrid } from '#/components/page'
import { formatMoney } from '#/lib/customer-vocab'
import { QBO_ENTITY_LABELS, type QboEntity } from '#/lib/qbo-vocab'
import { getJobFinancials } from '#/lib/qbo.functions'
import { cn } from '#/lib/utils'

// A Job's P&L, laid out like the P&L page: stat cards, then a statement (revenue by invoice, Job costs by QuickBooks
// account, plus crew paid outside QuickBooks so crew pay counts once, then profit), then the QuickBooks transactions.
// Loaded after the page.

type Fin = Awaited<ReturnType<typeof getJobFinancials>>
type Txn = Fin['transactions'][number]

const money = (c: number) => (c === 0 ? '–' : formatMoney(c))
const pct = (p: number | null) => (p === null ? '–' : `${p}%`)
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function JobMoneyPanel({ jobId, quotedCents }: { jobId: string; quotedCents?: number | null }) {
  const [fin, setFin] = useState<Fin | null>(null)
  const [showTxns, setShowTxns] = useState(false)
  useEffect(() => {
    getJobFinancials({ data: { jobId } }).then(setFin, () => setFin(null))
  }, [jobId])
  if (!fin) return null
  const t = fin.totals
  const live = fin.transactions.filter((r) => !r.deleted)
  const invoices = live.filter((r) => r.kind === 'revenue' || r.kind === 'revenue_credit')
  // Costs by QuickBooks account (credits subtract).
  const costByAccount = new Map<string, number>()
  for (const r of live) {
    if (r.kind !== 'cost' && r.kind !== 'cost_credit') continue
    const k = r.account ?? 'Other costs'
    costByAccount.set(k, (costByAccount.get(k) ?? 0) + (r.kind === 'cost' ? r.amountCents : -r.amountCents))
  }
  const costRows = [...costByAccount.entries()].sort((a, b) => b[1] - a[1])
  const toInvoice = quotedCents != null ? quotedCents - t.revenueCents : null

  return (
    <section aria-label="P&L" className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Receipt className="size-4 text-muted-foreground" />
        P&amp;L
      </h2>

      <StatGrid>
        <StatCard
          label="Revenue"
          value={formatMoney(t.revenueCents) || '$0'}
          hint={`Invoiced; ${formatMoney(t.paidCents) || '$0'} paid${toInvoice !== null && toInvoice > 0 ? `, ${formatMoney(toInvoice)} of the quote still to invoice` : ''}`}
        />
        <StatCard label="Job costs" value={formatMoney(t.allInCostCents) || '$0'} hint="QuickBooks costs on this Job, plus crew paid outside QuickBooks" />
        <StatCard label="Profit" value={formatMoney(t.allInProfitCents) || '$0'} hint="Revenue minus Job costs" />
        <StatCard label="Margin" value={pct(t.allInMarginPct)} hint="Profit as a share of revenue" />
      </StatGrid>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <tbody className="tabular-nums">
            <tr className="bg-muted/40">
              <th scope="rowgroup" colSpan={2} className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground uppercase">
                Revenue
              </th>
            </tr>
            {invoices.length === 0 ? (
              <tr>
                <td className="px-3 py-1.5 text-muted-foreground">No invoices on this Job yet</td>
                <td />
              </tr>
            ) : (
              invoices.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-1.5">
                    {r.kind === 'revenue_credit' ? 'Credit memo' : 'Invoice'} {r.docNumber ?? ''} <span className="text-muted-foreground">· {shortDate(r.txnDate)}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right">{r.kind === 'revenue_credit' ? `-${formatMoney(r.amountCents)}` : money(r.amountCents)}</td>
                </tr>
              ))
            )}
            <tr className="border-t font-semibold">
              <td className="px-3 py-1.5">Total revenue</td>
              <td className="px-3 py-1.5 text-right">{money(t.revenueCents)}</td>
            </tr>

            <tr className="border-t bg-muted/40">
              <th scope="rowgroup" colSpan={2} className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground uppercase">
                Job costs
              </th>
            </tr>
            {costRows.map(([account, cents]) => (
              <tr key={account} className="border-t">
                <td className="px-3 py-1.5">{account}</td>
                <td className="px-3 py-1.5 text-right">{money(cents)}</td>
              </tr>
            ))}
            {t.crewOutsideCents > 0 && (
              <tr className="border-t">
                <td className="px-3 py-1.5">
                  Crew paid outside QuickBooks{t.crewOutsideNotes ? <span className="text-muted-foreground"> ({t.crewOutsideNotes})</span> : null}
                </td>
                <td className="px-3 py-1.5 text-right">{money(t.crewOutsideCents)}</td>
              </tr>
            )}
            {costRows.length === 0 && t.crewOutsideCents === 0 && (
              <tr className="border-t">
                <td className="px-3 py-1.5 text-muted-foreground">No costs on this Job yet</td>
                <td />
              </tr>
            )}
            <tr className="border-t font-semibold">
              <td className="px-3 py-1.5">Total Job costs</td>
              <td className="px-3 py-1.5 text-right">{money(t.allInCostCents)}</td>
            </tr>

            <tr className="border-t-2 font-semibold">
              <td className="px-3 py-2">Profit</td>
              <td className={cn('px-3 py-2 text-right', t.allInProfitCents < 0 && 'text-destructive')}>{money(t.allInProfitCents)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Crew paid through QuickBooks is in its account above; crew paid another way is added once it's verified under Crew time.
        {t.crewUnverifiedCents > 0 && ` ${formatMoney(t.crewUnverifiedCents)} of crew time isn't verified yet and isn't counted.`}
        {t.allInMarginPct === null && ' Margin shows once the Job has both invoices and costs.'}
      </p>

      <div className="border-t pt-3">
        {live.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No QuickBooks transactions on this Job yet. Sort them on{' '}
            <Link to="/transactions" className="underline">
              Transactions
            </Link>
            .
          </p>
        ) : (
          <>
            <button type="button" aria-expanded={showTxns} onClick={() => setShowTxns((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ChevronDown className={cn('size-4 transition-transform', showTxns && 'rotate-180')} aria-hidden />
              QuickBooks transactions ({live.length})
            </button>
            {showTxns && <TxnList rows={live} />}
          </>
        )}
      </div>
    </section>
  )
}

function TxnList({ rows }: { rows: Txn[] }) {
  return (
    <ul className="mt-2 divide-y text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground tabular-nums">{r.txnDate}</span> · {QBO_ENTITY_LABELS[r.entity as QboEntity] ?? r.entity} · {r.partyName ?? r.account}
          </span>
          <span className="shrink-0 tabular-nums">{formatMoney(r.amountCents)}</span>
        </li>
      ))}
    </ul>
  )
}
