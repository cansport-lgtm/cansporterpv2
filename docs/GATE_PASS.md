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
| Sales | **One** pending dispatch (DC) of approved sales orders — one gate pass per dispatch, one dispatch per live pass; the store pass links to the same dispatch (`docs/STORE_PASS.md`). Once saved, only a super admin can change the dispatch on the pass (`20261010120000_store_pass_one_to_one.sql`); anyone else cancels and makes a new one | Automatic | None — the dispatch already moved it |
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

### The guard's screen (`gate_security`)

A gate keeper who reads little gets a picture-and-colour version of Gate Check
(`src/pages/gate-pass/GuardGateCheckPage.tsx`); managers keep the detailed
page. Urdu large, English small, one job per screen, and the phone speaks each
step in Urdu (a speaker button on every screen mutes it; the choice is kept on
the phone):

- **Home:** one big SCAN button. The QR code decides what the paper is
  (`GP-`, `LGP-`, `SGP-`, `GIN-`), so there are no tabs. Four picture tiles
  (goods out, goods back, worker, staff) are for a vehicle or person with no
  paper and open a digits-only keypad.
- **Goods going out:** for the number plate and for every line the guard
  answers one question, **same** or **different**. Only on *different* does a
  minus / plus counter (or the plate input) appear. The green **GO** button
  shows only when everything is the same; otherwise the red **STOP and tell
  office** button holds the pass. Both call the same `gate_pass_gate_check`.
- **Green screen** (out): a two-note beep and one vibration, then *next*.
- **Red screen** (held, or an old pass scanned again): the siren for an old
  pass, a short buzz for a held pass, what is short in large Urdu, **CALL
  OFFICE** (dials 0333 2216339, `OFFICE_PHONE` in `src/lib/guardUi.ts`),
  silence, next.
- **Worker / staff:** the existing photo-compare panel under an Urdu header.
- **Goods coming back:** see `docs/GATE_INWARD.md`.

Scrap passes still use the weighbridge panel inside the guard screen.

- Everything matches → **Out**. Sales dispatches on the pass become **Delivered**,
  dated the day the vehicle left.
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

## Freight voucher (sales passes)

Database: `supabase/migrations/20261012130000_gate_pass_freight.sql`; plan and
decisions in `docs/DISPATCH_FREIGHT_VOUCHER_PLAN.md`. The vouchers are a log,
reconciled by hand with the cash book; nothing posts to the ledger yet.

- **On the pass** (sales type, section *5. Freight*): who pays — **Company
  pays**, **Customer paid** or **Customer's own vehicle**. When the company
  pays: the mode (contractor van / online rickshaw / bike), the transporter
  (picked from the list, or a new name typed, which is saved to the list),
  the amount and the app's ride number. A sales pass cannot be submitted
  without it. The amount is never printed on the gate pass; the printout only
  says e.g. "Freight: Company pays · Contractor van · Shahid Transport".
- **At Out** (guard scan, manager release, backfill) a company-pays pass gets
  a **freight voucher** `FV-000001`, … dated the gate-out day, as **unpaid**,
  with a snapshot of the pass (DCs, customers, vehicle, driver, transporter,
  amount). The cashier roles and the pass maker are notified. Customer-paid
  passes get no voucher (the pass history says so).
- **Freight Vouchers** page (`/gate-pass/freight`; for cashiers also
  `/accounting/freight-vouchers` and `/expenses/freight-vouchers`): Unpaid /
  Paid / All tabs, filters, search, Excel; owed per transporter, this month by
  transporter and by mode, customer-paid loads. **Mark paid** (date, cash
  paid, photo of the signed slip, remark) or **Pay selected**: several unpaid
  trips of one contractor at once on a **payment statement** `FPS-000001`, …
  printed for the contractor's signature; each voucher keeps its own row and
  the statement number. The voucher prints with signature lines for the
  driver / transporter and the cashier.
- **Transporters** page (`/gate-pass/transporters`, managers): one row per
  **contractor** (paid per trip, settled together) and one per **app**
  (Bykea, InDrive… a different driver every ride, the ride number goes on the
  pass); phone, usual mode, default rate (prefills the amount), active. Per
  transporter: its trips, what is owed now, month totals, statements. Super
  admins set the unpaid reminder (default 3 days; a morning notification at
  09:10 Pakistan time lists what is older).
- **Changes after Out** (managers, reason required, on the pass's Freight
  card): correcting the amount / transporter / driver updates the unpaid
  voucher; switching to customer-paid cancels it; a paid voucher must be
  cancelled first (Freight Vouchers page) and a new one made from the pass.
  Everything is in the pass history and the voucher's own history.
- **Who**: `gate_pass_officer` / `gate_pass_manager` record freight;
  `gate_pass_manager` manages transporters, corrections and cancellations;
  the cashier (`pettycash_handler`, `accounting_poster` / `officer` /
  `manager`, `gate_pass_manager`) marks paid; `gate_pass_viewer`,
  `dispatch_operator` and `sales_order_manager` read (the dispatch list shows
  a **Freight** column). `gate_security` can never read freight, voucher or
  transporter rows.
- Rollback: `supabase/rollbacks/20261012130000_gate_pass_freight_down.sql`.

### Inward freight on the GRN

Database: `supabase/migrations/20261014120000_grn_freight.sql` (rollback in
`supabase/rollbacks/`); plan in `docs/GRN_FREIGHT_VOUCHER_PLAN.md`. The same
vouchers, for purchase deliveries:

- **On the GRN** (Goods Receipt → New GRN, section *Freight*, required):
  **Supplier's own vehicle** (or included in the price) · **Supplier billed
  it** (the amount is added to the GRN total, i.e. the supplier's payable) ·
  **Company paid transporter** · **Company paid, recover from supplier**
  ("to pay" bilty) · **On another GRN** (same vehicle; points at the GRN the
  trip was recorded on). Company paid: mode (contractor van, online rickshaw,
  bike, **goods company (bilty)**), transporter, amount, ride / bilty no.,
  vehicle and driver (prefilled from the gate inward entry).
- **When the GRN is saved** a company-paid freight gets an inward voucher
  `FV-…` (same series), dated the receipt date, **unpaid**, and the cashiers
  are notified. A toast offers **Print voucher**; the GRN list has a
  **Freight** column (click the FV number to print) and the GRN view a
  *Freight* block with **Freight voucher** (print) and **Change**.
- **Company-paid freight is not in the GRN total**: the supplier is not owed
  it. With **recover from supplier** the GRN's ledger posting credits Accounts
  Payable that much less and **Freight Inward** the difference (map the
  *Freight Inward (expense)* slot on Accounting → Default Accounts).
- **Changing it later**: the GRN maker or a manager (`purchase_manager`,
  `gate_pass_manager`, `super_admin`), with a reason. An unpaid voucher is
  corrected or cancelled; a paid voucher must be cancelled first (gate pass
  or purchase manager, Freight Vouchers page). Deleting a GRN cancels its
  unpaid voucher and is refused while the voucher is paid.
- **Paying**: Freight Vouchers page, as above, with a **Direction** filter
  (outward / inward); *Pay selected* can mix a transporter's inward and
  outward trips on one statement.
- **Who**: anyone who can make a GRN records it and can read and print inward
  vouchers (not outward ones).

## Manual backfill

- Managers only, on the New Gate Pass form ("Manual backfill of a paper pass").
- Needs the paper book and serial (inside the book's range, not used, not
  spoiled), the date and time written on paper (within the backfill limit,
  default 7 days), a photo of the paper pass and a reason.
- Saved straight to **Out**, dated on paper, with the same stock effects as
  the type (e.g. dispatches set to Delivered, scrap out of the yard).
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
  **Gate out**. When a pass goes out, its pending or in-transit dispatches are
  set to **Delivered** automatically, with the actual delivery date set to the
  gate-out day (the status dropdown still allows corrections). Nothing else in
  dispatch, invoicing or COGS changes.
- WIP Ledger: finished-goods samples appear at the FG level as
  **Samples (gate pass)**, next to Sales (in bags of 25 dozen, like Sales).
- Stock Movements: sample issues, returnable / job-work transfers to and from
  **Out for repair** / **At job work**, job-work use and output, and wastage,
  all with reference type `gate_pass`.
- Spare parts: `current_stock` goes down when a spare part goes out on a
  returnable pass and back up when it is received.
