// QuickBooks transactions (docs/adr/0006-quickbooks-sync.md): which QuickBooks records the CRM copies and how each
// counts on a Job. Safe for the browser.
// - cost: money out for a job (Purchase = expense / check / card charge; Bill)
// - cost_credit: money back on a cost (VendorCredit; a Purchase marked Credit, e.g. a card refund)
// - revenue: billed to the customer (Invoice; SalesReceipt)
// - revenue_credit: taken back from the customer (CreditMemo)
// - payment: money the customer paid against invoices. Shown, never added to revenue (that would count it twice).
// BillPayment and Deposit are left out for the same reason; JournalEntry is accountant territory.

export const QBO_ENTITIES = ['Purchase', 'Bill', 'VendorCredit', 'Invoice', 'SalesReceipt', 'CreditMemo', 'Payment'] as const
export type QboEntity = (typeof QBO_ENTITIES)[number]

export const QBO_KINDS = ['cost', 'cost_credit', 'revenue', 'revenue_credit', 'payment'] as const
export type QboKind = (typeof QBO_KINDS)[number]

export const QBO_ENTITY_LABELS: Record<QboEntity, string> = {
  Purchase: 'Expense',
  Bill: 'Bill',
  VendorCredit: 'Vendor credit',
  Invoice: 'Invoice',
  SalesReceipt: 'Sales receipt',
  CreditMemo: 'Credit memo',
  Payment: 'Payment received',
}

export const ASSIGNMENTS = ['job', 'overhead'] as const
export type Assignment = (typeof ASSIGNMENTS)[number]

/** A Job's money from QuickBooks. Costs net of credits; revenue = invoiced net of credit memos; payments separate. */
export function jobTotals(rows: { kind: string; amountCents: number; deleted?: boolean }[]) {
  const sum = (k: QboKind) => rows.filter((r) => r.kind === k && !r.deleted).reduce((a, r) => a + r.amountCents, 0)
  const costCents = sum('cost') - sum('cost_credit')
  const revenueCents = sum('revenue') - sum('revenue_credit')
  return { costCents, revenueCents, paidCents: sum('payment'), profitCents: revenueCents - costCents, marginPct: marginPct(revenueCents, costCents) }
}

/** Profit as a share of what was invoiced, rounded. Null until a Job has both invoices and costs on it (otherwise a
 * Job whose costs are not sorted yet would show 100%). */
export function marginPct(revenueCents: number, costCents: number) {
  return revenueCents > 0 && costCents > 0 ? Math.round((100 * (revenueCents - costCents)) / revenueCents) : null
}

/** QuickBooks accounts that hold the owner's draws and personal spending (and personal income tax). Private: the sync
 * never copies them into the CRM, so no Staff member or connector sees them. */
export const OWNER_ACCOUNTS = ["Owner's Pay & Personal Expenses"] as const
