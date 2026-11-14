---
status: accepted
---

# QuickBooks transactions sync into the CRM nightly; Jobs and Claude read them there

Kristin wants Job costs and revenue from QuickBooks without exports, and wants Claude to read transactions. The Claude
QuickBooks connector exposes reports, not transactions, and tagging expenses to customers inside QuickBooks is not
done today. So the CRM keeps its own copy and does the sorting.

- **Connection:** an admin connects once (Settings > QuickBooks, OAuth 2.0 with an Intuit developer app; secrets
  `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`; redirect URI `<CRM>/api/qbo/callback`). Tokens are AES-GCM encrypted in
  `qbo_connection` with a key derived from `BETTER_AUTH_SECRET`. Intuit rotates the refresh token on every refresh; the
  nightly sync keeps it alive.
- **Sync:** cron `17 9 * * *` (UTC) and "Sync now". First run queries Purchase, Bill, VendorCredit, Invoice,
  SalesReceipt, CreditMemo and Payment dated from 2025-01-01; later runs use Change Data Capture since the last sync
  (re-running the full pull if the gap is over 29 days). Read only: nothing is written to QuickBooks.
- **Counting:** cost (Purchase, Bill), cost credit (VendorCredit, credit-card refunds), revenue (Invoice, SalesReceipt),
  revenue credit (CreditMemo), payment (shown, never added to revenue). BillPayment and Deposit are left out so nothing
  counts twice; JournalEntry is accountant territory.
- **Sorting:** customer-side records whose customer name matches one Customer go on that Customer's Job automatically
  (`assigned_by = auto`). Costs get a suggested Job (customer surname in the memo or a line, else the one Job being
  built that day) and wait on the Transactions page, or for Claude (`assign_transactions`), to be put on a Job or marked
  overhead. Sorting survives re-syncs.
- **Claude:** MCP tools `list_transactions`, `assign_transactions`, `job_financials`, `quickbooks_status`.

## Consequences

- Intuit's free Builder tier allows 500,000 read calls a month; this uses a few hundred.
- Splitting one receipt across two Jobs is not supported yet (put it on the main Job, or overhead).
- Job "Actual material cost" stays a hand-entered field for now; the QuickBooks totals show beside it on the Job page.
