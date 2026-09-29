# Gate Pass (outward)

Every outward movement through the factory gate gets a gate pass from one
number series: `GP-000001`, `GP-000002`, … A number is given only when a pass
saves successfully, so failed saves never leave gaps.

Database: `supabase/migrations/20260928120000_gate_pass_roles.sql` (roles),
`20260928120100_gate_pass.sql` (Phase 1), `20260929120000_gate_pass_phase2_3.sql`
(returnable, job work, scrap, backfill) and `20260930120000/120100_gate_pass_type_manager*`
(approval by type). Rollbacks in `supabase/rollbacks/`.

## Pass types

| Type | Linked to | Approval | Stock |
|---|---|---|---|
| Sales | One or more pending dispatches of approved sales orders, on one vehicle | Automatic | None — the dispatch already moved it |
| Supplier return | A purchase return | Automatic | None — the purchase return already moved it |
| Sample | Customer, distributor or anyone else; finished goods or free text | Sample manager | FG lines are issued when the vehicle goes out |
| Returnable | Supplier / repairer or anyone; machines, fixed assets, spare parts, store items, products or free text; due-back date | Returnable manager | Store items / products move to **Out for repair**; spare parts leave `spare_parts.current_stock`; both come back on a receipt |
| Job work | Vendor, process (printing, cutting…), material sent and what it comes back as; due-back date | Job work manager | Material moves to **At job work**; each receipt uses it up there and receives the processed item; the rest is vendor wastage on close |
| Scrap | Buyer; scrap categories with expected weight and a rate for this sale | Scrap manager | Out of the **Scrap Yard** by the weight measured at the gate |
| Manual backfill | Any type above, entered later from a paper pass | Entered by a manager | Same as its type, dated on the paper |

A dispatch or purchase return can be on only one live pass at a time
(cancelled and rejected passes free it again).

## Flow

```
draft → pending approval (not sales / supplier return) → approved → out
                                            ↘ held → out (manager release)
cancel: any time before out · reject: while pending approval
returnable / job work:  out → partly returned → returned   (or closed by a manager)
```

## At the gate

The guard opens the pass (scan the QR on the printout, or type the number),
types the vehicle number seen, and counts every line — cartons where the line
has them, otherwise the quantity.

- Everything matches → **Out**. Sales dispatches on the pass become In Transit.
  Finished-goods samples are issued from stock.
- Anything differs → **Held**. The pass maker and the gate pass managers are
  notified. The vehicle must not leave.

### Old pass scanned again

If the guard opens a pass that already went out (or was returned, closed,
cancelled or rejected), Gate Check turns red, sounds a siren for 20 seconds
(the guard can silence it) and vibrates the phone: **do not let the vehicle
go**. Every attempt is logged in the pass history (`rescan_attempt`: who, when,
the pass status). Managers, super admins and the pass maker get a notification,
at most once per pass every 10 minutes. The Gate Pass list and dashboard show a
red **Old passes scanned again** card for the last 7 days, and the pass page
shows a red banner.

## Releasing a held pass (managers)

- **Short count:** release with the counted quantity (a reason is required).
  The first printed figures stay in the pass history.
  - Sales: correct the dispatch to what was counted first (or take that
    dispatch off the pass). Release re-reads the dispatches and requires them
    to match the count.
  - Sample / supplier return: the lines are cut to the count; stock moves
    only for what left.
- **Over count (more goods than the pass):** never released. Unload the extra
  and have the guard count again, or cancel and make a new pass.
- **Wrong vehicle:** never released. Cancel and make a pass for the right
  vehicle.

If a dispatch is edited after its sales pass was made, the gate check stops
with "Ask the office to refresh the pass" — use **Refresh from dispatches** on
the pass.

## Returnable and job work

- **Receive goods** (on the pass) records what came back: for a returnable, the
  quantity returned per line; for job work, the material used up, the
  processed goods received good, and what you rejected. Each receipt gets a
  `GPR-` number.
- **Close pass** (managers): whatever is still out is booked as vendor wastage
  (job work) or written off (returnable), with a reason.
- **Returns & Job Work** page: everything outside now, overdue first, and the
  job-work reconciliation per vendor (sent / used / received / rejected /
  wastage / still with vendor).
- Overdue passes are notified to the pass maker and managers every morning
  (09:05 Pakistan time).

## Scrap

- **Scrap Yard** page: stock per category = opening balance (super admin, locked
  once the category has movements) + **Scrap In** entries − scrap sold.
- A scrap pass lists categories with the expected weight and the rate for this
  sale. Rates are stored separately and the gate guard can never read them.
- At the gate the guard weighs the empty truck, then after each category,
  enters the slip numbers and takes a photo of the weighbridge slip. The net
  weights become the pass quantities and leave the Scrap Yard.
- **Held (never released)** if the vehicle does not match, a category is more
  than the yard holds, or the total is over the approved weight by more than
  the allowed overweight (default 10%). Unload and weigh again, or cancel.

## Manual backfill

- Managers only, on the New Gate Pass form ("Manual backfill of a paper pass").
- Needs the paper book and serial (inside the book's range, not used, not
  spoiled), the date and time written on paper (within the backfill limit,
  default 7 days), a photo of the paper pass and a reason.
- Saved straight to **Out**, dated on paper, with the same stock effects as
  the type (e.g. dispatches set to In Transit, scrap out of the yard).
- **Paper Books** page: books and serial ranges, a serial map showing entered,
  spoiled and **gap** serials (not entered but before the last entered one),
  marking a serial spoiled, and the backfill register. Super admins set the
  backfill limit and the scrap overweight allowance there.

## Roles

| Role | Can |
|---|---|
| `gate_pass_manager` | Make, release held passes, cancel any pass, take a dispatch off a pass, gate check, close returnable / job-work passes, manual backfill, paper books |
| `gate_pass_sample_manager` | Approve / reject Sample passes only |
| `gate_pass_returnable_manager` | Approve / reject Returnable passes only |
| `gate_pass_jobwork_manager` | Approve / reject Job work passes only |
| `gate_pass_scrap_manager` | Approve / reject Scrap passes only (can read scrap rates) |
| `gate_pass_officer` | Make and submit passes; cancel own draft / pending pass; receive goods back; Scrap In |
| `gate_pass_viewer` | Read only |
| `gate_security` | Gate Check page only (count, or weigh scrap); never sees prices or scrap rates |
| `super_admin` | Everything, plus scrap categories, Scrap Yard opening balances and settings |

The "needs approval" notice goes only to that type's manager (and super admins).
The general `gate_pass_manager` does not approve sample, returnable, job-work or
scrap passes. Type managers see the Gate Pass pages read-only and land on
Approvals, which shows only their types.

Every write goes through the `gate_pass_*` database functions, which check
these roles; the tables are read-only to the app.

## Effects on existing pages

- Dispatch list and dispatch dashboard: two extra columns, **Gate pass** and
  **Gate out**. When a pass goes out, its pending dispatches are set to
  **In Transit** automatically. Nothing else in dispatch, invoicing or COGS
  changes.
- WIP Ledger: finished-goods samples appear at the FG level as
  **Samples (gate pass)**, next to Sales (in bags of 25 dozen, like Sales).
- Stock Movements: sample issues, returnable / job-work transfers to and from
  **Out for repair** / **At job work**, job-work use and output, and wastage,
  all with reference type `gate_pass`.
- Spare parts: `current_stock` goes down when a spare part goes out on a
  returnable pass and back up when it is received.
