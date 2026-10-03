# Store Pass (finished goods handed over for dispatch)

A **store pass** records the finished goods the FG store hands over for one
vehicle, *before* the vehicle reaches the gate. One number series:
`SP-000001`, `SP-000002`, … given only when a pass saves successfully.

```
Sales order → Dispatch DC → Store pass SP (store keeper) → Gate pass GP → Gate out → In Transit
                                   ↓                                   ↓
                              Daily store ↔ gate reconciliation (step 2)
```

Database: `supabase/migrations/20261008120000_store_pass_roles.sql` (roles) and
`20261008120100_store_pass.sql` (tables, views, functions). Rollback in
`supabase/rollbacks/20261008120100_store_pass_down.sql`. Plan and decisions:
`docs/STORE_PASS_PLAN.md`.

## What a pass is

| | |
|---|---|
| Covers | **One vehicle**, carrying one or more pending **domestic** dispatches (`sales_dispatches`, `sales_segment = domestic`) of approved sales orders — the same shape as the sales gate pass. A dispatch can be on only one live (not cancelled) store pass |
| Lines | Copied from the dispatch items, grouped by dispatch: product, packing, dozens, cartons. The dispatch figures are kept as a snapshot; the store keeper confirms or corrects what was **issued** |
| Also records | Vehicle, driver, pass date, issue time and store keeper, who received the goods (loader / driver), store location / bay, remarks, optional photo of the loaded stack |
| Approval | None — tracking only. Issuing stamps who and when |
| Stock | **None.** The dispatch already moves finished goods (WIP ledger FG level, COGS). The store pass is a control document |
| Prices | Never stored or shown |

## Flow

```
draft → issued → (cancelled)
```

- **Draft**: the store keeper can edit lines, add or remove dispatches, refresh
  from the dispatches (the office may have edited them) and cancel.
- **Issued**: goods have left the store; lines are frozen. Only a store pass
  manager (or super admin) can cancel it, with a reason; the keeper then makes
  a new one. The original stays in the pass history.
- Issuing **short** of the dispatch is allowed but needs a remark on the line;
  it shows on the pass and in the reconciliation. Issuing **more** than the
  dispatch is refused — the office corrects the dispatch first.
- A dispatch must still be **pending** (the vehicle has not left) to go on a
  store pass. A dispatch that went out with no store pass stays visible as
  such in tracking and reconciliation.

## Pages (sidebar group **Store Pass**, module `store_pass`)

| Page | Route | What it shows |
|---|---|---|
| Store Passes | `/store-pass/passes` | Register with date range, status and search; Excel export; cards for issued today, issued-but-no-gate-pass, dispatches with no store pass, held at gate |
| New Store Pass | `/store-pass/new` | Vehicle and driver → tick the pending domestic dispatches on it (the first one fills in the vehicle) → lines per dispatch with issued dz / ctn and remark → receiver, bay, photo, remarks → **Issue** or **Save as draft** |
| Store pass | `/store-pass/passes/:id` | Lines with DC vs issued and the difference, the dispatches with their gate pass and gate-out time, details, photo, history; Print, Edit / Refresh / Issue (draft), Cancel |
| Dispatch Tracking | `/store-pass/tracking` | One row per domestic dispatch: DC → SP → GP → Out → Delivered as a stage strip with the hours between steps; stage chips as filters; open stages shown whatever their date; Excel export |

Gate pass managers see **Dispatch Tracking** in the Gate Pass group too.

## Effects on existing pages

- **Domestic Dispatch** list and **Dispatch Dashboard**: one extra column,
  **Store pass** (SP number and issue time, or —), next to Gate pass / Gate out.
- **New Gate Pass (Sales)**: the dispatch picker shows each dispatch's store
  pass (`SP-… · 14:05`, `draft`, or **No store pass**). Informational — the
  gate pass is not blocked (that is step 2's setting).
- Nothing in dispatch, gate counting, invoicing or COGS changes.

## Database

Tables (read-only to the app; writes through `store_pass_*` functions):
`store_passes`, `store_pass_dispatches` (which dispatches travel on a pass),
`store_pass_items` (lines, with `dispatch_quantity` / `dispatch_packages` as
the snapshot and `quantity` / `packages` as issued), `store_pass_events`.

Views: `v_dispatch_store_pass` (live store pass per dispatch),
`v_store_gate_tracking` (one row per domestic dispatch with DC, SP and GP
figures, gate counts and the `stage` reached: `no_store_pass`, `draft`,
`issued`, `on_gate_pass`, `held`, `out`, `delivered`, `returned`).

Functions: `store_pass_save(p_id, p_data, p_issue)`, `store_pass_issue`,
`store_pass_cancel`, `store_pass_refresh`. Internal: `store_pass_build`
(rebuilds links and lines from the dispatches and validates them),
`store_pass_current_lines`, `store_pass_log`, `store_pass_notify`.

## Roles

| Role | Can |
|---|---|
| `store_pass_officer` (store keeper) | Make, issue and print passes; edit / cancel own drafts |
| `store_pass_manager` | Everything above, plus cancel an issued pass (reason), and in step 2 explain discrepancies |
| `store_pass_viewer` | Read only |
| `gate_pass_manager` | Read Dispatch Tracking (and the reconciliation in step 2) |
| `super_admin` | Everything |

Store pass roles are module tiers (`AuthContext` `MODULE_TIER_DEFINITIONS`):
confined to `/store-pass/*` plus the dashboard shell; they never reach a page
with prices.

## Step 2 (next)

Daily Reconciliation page (per dispatch and per product, discrepancy codes,
manager "Explained" notes), Store Pass dashboard, Gate Check notice when a
sales pass has a dispatch without a store pass (`off / warn / block` setting,
default `warn`), and the 20:30 daily discrepancy notification.
