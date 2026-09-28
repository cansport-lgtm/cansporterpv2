# Gate Pass (outward) — Phase 1

Every outward movement through the factory gate gets a gate pass from one
number series: `GP-000001`, `GP-000002`, … A number is given only when a pass
saves successfully, so failed saves never leave gaps.

Database: `supabase/migrations/20260928120000_gate_pass_roles.sql` (roles) and
`20260928120100_gate_pass.sql` (everything else). Rollback:
`supabase/rollbacks/20260928120100_gate_pass_down.sql`.

## Pass types

| Type | Linked to | Approval | Stock |
|---|---|---|---|
| Sales | One or more pending dispatches of approved sales orders, on one vehicle | Automatic | None — the dispatch already moved it |
| Supplier return | A purchase return | Automatic | None — the purchase return already moved it |
| Sample | Customer, distributor or anyone else; finished goods or free text | Gate pass manager | FG lines are issued when the vehicle goes out |
| Returnable, Job work | — | Phase 2 | — |
| Scrap, Manual backfill | — | Phase 3 | — |

A dispatch or purchase return can be on only one live pass at a time
(cancelled and rejected passes free it again).

## Flow

```
draft → pending approval (samples only) → approved → out
                                            ↘ held → out (manager release)
cancel: any time before out · reject: while pending approval
```

## At the gate

The guard opens the pass (scan the QR on the printout, or type the number),
types the vehicle number seen, and counts every line — cartons where the line
has them, otherwise the quantity.

- Everything matches → **Out**. Sales dispatches on the pass become In Transit.
  Finished-goods samples are issued from stock.
- Anything differs → **Held**. The pass maker and the gate pass managers are
  notified. The vehicle must not leave.

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

## Roles

| Role | Can |
|---|---|
| `gate_pass_manager` | Make, approve / reject, release held passes, cancel any pass, take a dispatch off a pass, gate check |
| `gate_pass_officer` | Make and submit passes; cancel own draft / pending pass |
| `gate_pass_viewer` | Read only |
| `gate_security` | Gate Check page only; never sees prices (none are stored on a pass) |

Every write goes through the `gate_pass_*` database functions, which check
these roles; the tables are read-only to the app.

## Effects on existing pages

- Dispatch list and dispatch dashboard: two extra columns, **Gate pass** and
  **Gate out**. When a pass goes out, its pending dispatches are set to
  **In Transit** automatically. Nothing else in dispatch, invoicing or COGS
  changes.
- WIP Ledger: finished-goods samples appear at the FG level as
  **Samples (gate pass)**, next to Sales (in bags of 25 dozen, like Sales).
- Stock Movements: each sample line out is an `issue` of finished goods with
  reference type `gate_pass`.
