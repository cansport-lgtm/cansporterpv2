# Expense Account Links and Expense Reconciliation

Operational expense records (petty cash, staff trip fuel) are paid in cash and
posted to the ledger by the accountants by hand. This feature links each source to
the ledger account it is posted to and warns when the two disagree.

Migration: `supabase/migrations/20261013120000_expense_account_links.sql`
(rollback in `supabase/rollbacks/`).

## Settings page

**Accounting → Masters → Expense Account Links** (`/accounting/expense-links`).
Edit: `super_admin`, `accounting_manager`. Everyone else can view.

One row per source: **Staff Trip Fuel** and each **petty cash category**.

| Field | Meaning |
|---|---|
| Expense account | Active expense account of the chart of accounts the payments are debited to |
| Funding (cash) account | Active cash or bank account that funds it (Petty Cash 6002). Only vouchers that also touch this account count on the ledger side. Empty = any posting on the expense account |
| Tolerance Rs | Difference allowed before a month is flagged. Default 1 |
| Compare from | Nothing before this date is counted, on either side. Use it when the ledger holds older postings than the records |

- **Suggest by name** fills in only exact name matches (ignoring "Exp" / "Expense"
  / "Payment" / "Charges"). Nothing is saved until you press Save.
- A source with amounts this year but no link is flagged at the top.
- Removing a link only stops the comparison. It never changes petty cash, trip fuel
  or the ledger.
- Sources linked to the same expense account (and funding account) are compared
  together against that one account, so keep their compare-from dates the same.
- Seeded: Staff Trip Fuel → 5209 Fuel & Travel, funded from 6002 Petty Cash,
  tolerance Rs 1, compare from 1 Oct 2026.

New kinds of source (general expense categories, utility types) are added by
extending `source_type` and the two source queries in `expense_link_reconciliation`.

## How the check works

`expense_link_reconciliation(from, to)`, grain: expense account + funding account +
month.

- **Records side**
  - Trip fuel: vouchers with status `approved` (and earlier `paid` ones), by the date
    HR approved them (Asia/Karachi). HR approval is final, so there is no paid step.
  - Petty cash: `expense` entries whose approval status is not `rejected`, by entry
    date. (Entries are mostly still `pending`, so counting approved only would show
    nothing.)
- **Ledger side**: net debit minus credit on the expense account, in posted and
  reversed vouchers (a reversal nets itself out) that also touch the funding
  account, by voucher date.
- **Status**: `matched` when |records − ledger| ≤ tolerance, else `warning`. A
  source with amounts and no link comes back as `no_link`.

Version 1 compares **monthly totals**. A voucher-by-voucher check (TFV number
against the ledger line) is a later step.

### Reading a difference

- Records higher than the ledger: recorded but not posted yet, or posted to
  another account.
- Ledger higher than the records: posted twice, or from another source.

## Where it shows

- **Accounting → Reconciliation → Expense Reconciliation**
  (`/accounting/expense-reconciliation`): grouped by account, expandable months,
  differences-only filter, unlinked sources, Excel export.
- **Accounting Dashboard**: a card listing accounts with a difference this year.
- **Accounting → Reports → Trip Fuel Analysis**: the Ledger check panel; warns
  when trip fuel has no link.
- HR sees the trip fuel analysis only, never ledger figures.
