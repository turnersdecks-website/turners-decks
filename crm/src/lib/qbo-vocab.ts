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

/** 'ignored': not a Job cost or payment (gas, insurance, software...). Overhead may get its own place later. */
export const ASSIGNMENTS = ['job', 'ignored'] as const
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

// Sorting rules (docs/adr/0006-quickbooks-sync.md). A new cost lands in To sort when its QuickBooks account is a Job cost
// account, else it arrives Ignored. A vendor rule wins over the account. Invoices and payments always land in To sort
// (or on their Job automatically). Rules only touch transactions as they first arrive, or when Staff apply them to To
// sort; anything a person sorted is left alone.
export type VendorRule = { vendor: string; action: 'sort' | 'ignore' }
export type QboRules = { sortAccounts: string[]; vendors: VendorRule[] }

export const DEFAULT_QBO_RULES: QboRules = {
  sortAccounts: ['Job Supplies', 'Contractors', 'Cost of Goods Sold', 'Disposal & Dump Fees', 'Permits and Other Job Fees', 'Taxes & Licenses'],
  vendors: [],
}

const clean = (v: unknown, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Rules from storage or a form; anything malformed falls back to the defaults. */
export function parseQboRules(raw: unknown): QboRules {
  let v: unknown = raw
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw)
    } catch {
      return DEFAULT_QBO_RULES
    }
  }
  if (!v || typeof v !== 'object') return DEFAULT_QBO_RULES
  const o = v as { sortAccounts?: unknown; vendors?: unknown }
  const sortAccounts = Array.isArray(o.sortAccounts) ? [...new Set(o.sortAccounts.map((a) => clean(a)).filter(Boolean))].slice(0, 100) : DEFAULT_QBO_RULES.sortAccounts
  const vendors = Array.isArray(o.vendors)
    ? o.vendors
        .map((r) => ({ vendor: clean((r as VendorRule)?.vendor), action: (r as VendorRule)?.action === 'sort' ? 'sort' : 'ignore' }) as VendorRule)
        .filter((r) => r.vendor)
        .slice(0, 200)
    : []
  return { sortAccounts, vendors }
}

/** What the rules say about one transaction: 'sort' (To sort) or 'ignore'. */
export function ruleFor(t: { kind: string; account?: string | null; partyName?: string | null; memo?: string | null }, rules: QboRules): 'sort' | 'ignore' {
  if (t.kind !== 'cost' && t.kind !== 'cost_credit') return 'sort'
  const party = (t.partyName ?? '').toLowerCase()
  const memo = (t.memo ?? '').toLowerCase()
  const vendor = rules.vendors.find((r) => {
    const v = r.vendor.toLowerCase()
    return party === v || memo.includes(v)
  })
  if (vendor) return vendor.action
  return t.account && rules.sortAccounts.includes(t.account) ? 'sort' : 'ignore'
}
