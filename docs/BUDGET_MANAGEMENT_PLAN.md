# Budget Management System — Accounting Module Plan

Status: **Proposal / planning document** (no code changes yet).

## 1. Current State (what we're building on)

- The accounting module runs on the `accounting_*` schema: `accounting_chart_of_accounts` (hierarchical COA with `account_type` enum asset/liability/equity/revenue/expense), `accounting_vouchers` (headers) and `accounting_voucher_lines` (double-entry lines). The general ledger is derived at query time by aggregating voucher lines — the same pattern used by `TrialBalancePage`, `ProfitLossPage`, etc.
- There is **no fiscal-period table** in the active schema — only `accounting_period_close.closed_through_date`. Budget periods must therefore carry their own year/month keys.
- There are **no cost centers / departments / dimensions** on accounting voucher lines. The only dimensions available are `account_id` and `party_id`.
- A budget feature already exists in the **Expenses module** (`expense_budgets` table + `src/pages/expenses/ExpenseBudgetsPage.tsx`), but it budgets expense *categories/utilities/departments* against operational tables (`petty_cash_entries`, `general_expenses`, `utility_bills`) — it is **not connected to the accounting ledger**. It stays as-is; the new system budgets **COA accounts against ledger actuals**.
- Roles: `accounting_poster` / `accounting_officer` / `accounting_manager` (+ `super_admin`). Reports like P&L are manager-tier.

## 2. Recommended Design

### Scope (Phase 1)
Budget **P&L accounts** (account_type `revenue` and `expense`) per **month** within a **fiscal year**, compared against **actuals derived from `accounting_voucher_lines`**. Balance-sheet budgeting is rarely useful and is out of scope initially (the schema won't prevent it — we just default the UI to P&L accounts).

### Data model

Two new tables, following the existing migration conventions (UUID PKs, `created_at`/`updated_at` + shared trigger, permissive RLS + GRANTs):

```sql
-- Budget header: one per fiscal year (revisions supported later)
CREATE TABLE accounting_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                        -- e.g. "FY 2026-27 Operating Budget"
  fiscal_year_label TEXT NOT NULL,           -- e.g. "2026-27"
  start_year INT NOT NULL,                   -- first month of the budget
  start_month INT NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  num_months INT NOT NULL DEFAULT 12,
  status TEXT NOT NULL DEFAULT 'draft'       -- draft | active | closed
    CHECK (status IN ('draft','active','closed')),
  notes TEXT,
  approved_by UUID REFERENCES app_users(id),
  approved_at TIMESTAMPTZ,
  created_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Budget lines: one row per account per month
CREATE TABLE accounting_budget_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES accounting_budgets(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounting_chart_of_accounts(id),
  period_year INT NOT NULL,
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_id, account_id, period_year, period_month)
);
```

Why rows-per-month instead of 12 amount columns: it keeps queries symmetrical with how actuals are aggregated, supports budgets that don't start in January (Pakistani fiscal year is typically July–June), and makes partial-year budgets trivial.

Flexible start (`start_year`/`start_month`/`num_months`) means we don't need to hard-code whether the fiscal year is calendar or July–June — **decision needed from user** on the default.

### Actuals

Computed client-side exactly like `TrialBalancePage`:
aggregate `accounting_voucher_lines` (via `fetchAllRows`, `!inner` join to `accounting_vouchers` for date filtering) per `account_id` per month.
Sign convention: **expense actual = debit − credit**, **revenue actual = credit − debit**, so budget vs actual compares like with like.

### Enforcement: advisory, not blocking (Phase 1)

Recommendation: show budget-vs-actual warnings, do **not** hard-block voucher posting when a budget is exceeded. Reasons: much of the ledger is auto-posted from other modules (`source_module` idempotent postings) — a hard block would break sales/purchase/production flows; and blocking legitimate accounting entries mid-month causes more harm than an alert. A hard-block option can be added later as an `app_settings` flag if wanted.

### UI (Phase 1)

Three additions under a new **"Budgeting"** sidebar group in accounting:

1. **`/accounting/budgets` — Budget Setup** (`AccountingBudgetsPage.tsx`)
   - List of budgets (year, status, totals). Create/edit/activate.
   - Editor: grid of **accounts (rows) × months (columns)** for revenue and expense accounts, with per-row and per-column totals.
   - Productivity tools: "enter annual amount → spread evenly", "copy from previous year", "copy actuals from last year as starting point", XLSX export (import optional).
2. **`/accounting/budget-vs-actual` — Budget vs Actual Report** (`BudgetVsActualPage.tsx`)
   - Filters: budget (year), period range (single month / YTD / full year), account group.
   - Columns: Budget, Actual, Variance (amount + %), utilization progress bar, over-budget badges (same visual language as `ExpenseBudgetsPage`).
   - Grouped by account type/sub-category with subtotals and a net (revenue − expense) summary row; drill-down link per account to `GeneralLedgerPage`; XLSX export like other accounting reports.
3. **Dashboard widget** on `AccountingDashboard`: top over-budget accounts + overall utilization for the current month.

### Permissions

- Budget setup (create/edit/approve): `accounting_manager`, `super_admin`.
- Budget vs Actual report: same tier as P&L (`accounting_manager`, `super_admin`); optionally `accounting_officer` view-only later.
- Routes wrapped in `<ProtectedRoute requiredRoles={[...]}>` in `src/App.tsx`; sidebar entries with `allowedRoles`.

## 3. Phased Delivery

**Phase 1 — Core (recommended first implementation)**
- Migration `accounting_budgets` + `accounting_budget_lines`.
- Budget Setup page with grid editor + spread/copy tools.
- Budget vs Actual report with variance, utilization, XLSX export.
- Routes, sidebar group, role gating.

**Phase 2 — Workflow & visibility**
- Approval flow (draft → active with `approved_by`), budget revisions (copy-to-new-version, keep history).
- Over-budget alerts (banner on dashboard; optionally rows in a `accounting_budget_alerts` table like the expenses module's alert table).
- Advisory warning inside `NewVoucherPage` when a line would push an expense account over its active monthly budget.
- Audit-log entries (`accounting_audit_log`) for budget create/edit/approve.

**Phase 3 — Optional, larger scope (only if needed)**
- **Cost-center / department dimension**: add `department_id` (or a generic `cost_center_id`) to `accounting_voucher_lines` + backfill strategy + tag auto-posting flows, then budget per account × department. This touches every posting path, so it's deliberately separated.
- Hard budget enforcement flag, cash-flow budget, quarterly views.

## 4. Files touched (Phase 1)

| Layer | File |
|---|---|
| Migration | `supabase/migrations/<ts>_accounting_budgets.sql` |
| Pages | `src/pages/accounting/AccountingBudgetsPage.tsx`, `src/pages/accounting/BudgetVsActualPage.tsx` |
| Shared logic | `src/lib/accounting/budgetActuals.ts` (per-account per-month actuals aggregation, reused by report + dashboard widget + voucher warning) |
| Routing | `src/App.tsx` (accounting route block) |
| Navigation | `src/components/layout/ERPSidebar.tsx` (new "Budgeting" header under accounting) |
| Dashboard | `src/pages/accounting/AccountingDashboard.tsx` (widget) |

## 5. Decisions needed before implementation

1. **Fiscal year**: July–June (Pakistan standard) or calendar January–December? (Schema supports both; this sets the default when creating a budget.)
2. **Account scope**: P&L only (recommended), or also balance-sheet/capex accounts?
3. **Department budgeting**: needed now (big change — Phase 3) or later?
4. **Enforcement**: advisory warnings only (recommended), or hard-block over-budget vouchers?
5. **Who can see Budget vs Actual**: managers only (like P&L), or also `accounting_officer`?
