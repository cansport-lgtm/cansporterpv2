# Dispatch freight voucher at gate out — plan (revised 6 Oct 2026)

Decisions taken so far: the voucher is made **at gate out**; the cashier pays
**against it later** (the transporter / driver collects cash with the voucher);
the **gate pass maker** enters the freight; **no amount on the gate pass
print**; **no ledger posting yet** — a freight log and dashboard, reconciled
by hand with the cash book, and ledger integration later.

Every dispatch leaves on a hired vehicle: a contractor van, an online rickshaw
(Bykea / InDrive / Careem) or a bike. The driver is paid in cash, and today
that payment is written by hand afterwards. Sometimes the customer's own van
collects the stock and nothing is paid.

```
Sales order → Dispatch DC (office) → Gate pass GP (one vehicle, 1..n DCs)
                                          │  office fills "Freight": payer, mode, transporter, amount
                                          ▼
                              guard scans → count matches → OUT
                                          │
                     ┌────────────────────┴────────────────────┐
             payer = company                            payer = customer
   Freight voucher FV-000123 created (UNPAID)            no voucher
   cashier notified · slip printed                       pass shows "Customer paid"
                     │                                   (or "Customer's own vehicle")
   driver / transporter brings the slip
   cashier pays, marks PAID (date, who, signed slip photo)
                     │
   Freight log + dashboard  ──(manual reconciliation with cash book)
                     │
   later: PAID → cash payment voucher in the ledger (phase 2)
```

Nothing changes for the guard: the guard's screen, the count and the Out / Held
decision are untouched, and the guard never sees an amount (same rule as scrap
rates today).

---

## 1. Why on the gate pass, not on the dispatch (DC)

- A gate pass is **one vehicle**. A vehicle often carries several DCs, and the
  driver is paid once per trip. Freight per DC would be double-counted or
  split by hand.
- The gate pass is the document the guard scans, so "scan at gate → voucher"
  needs the money data to sit on the pass.
- `sales_dispatches` already has `transporter_name` and an unused
  `freight_charges` column. They stay as they are; the pass copies the
  transporter name from the DC as a default.
- Out of scope for now: the **distributor** module's dispatch sheet. It does
  not go through a gate pass today (no link to `sales_dispatches`), so there is
  no scan to hook. It can be added once distributor dispatches get a gate pass.

## 2. What the office enters on a sales gate pass

A new **Freight** section on the New Gate Pass form, sales type only, shown
right under Vehicle / Driver:

| Field | Values | Rule |
|---|---|---|
| Who pays | **Company pays** / **Customer paid** / **Customer's own vehicle** | Required to submit a sales pass |
| Mode | Contractor van / Online rickshaw / Bike | Required when company pays |
| Transporter | Pick from the transporter list, or type a new name (and phone) | Required when company pays; a new name is saved to the list |
| Driver name / phone | the pass already has these | Printed on the voucher as the person who collects |
| Amount (Rs) | > 0 | Required when company pays |
| Ride / booking ref | free text | For online rides: the Bykea / InDrive ride number |
| Note | free text | Optional |

- Prefilled: transporter from the DC's `transporter_name`; amount from the
  transporter's **default rate** (see §4) if one is set.
- Editable while the pass is draft or approved (not yet out). After out, only a
  **correction** on the voucher (see §6).
- Shown on the pass detail page and on the printout as a single line
  ("Freight: company pays · Contractor van · Shahid Transport" or "Freight:
  customer paid"). **No amount on the gate pass print**; it is on the voucher.
- Old passes (made before this goes live) are "Freight not recorded" and never
  get a voucher.

## 3. The freight voucher

Its own document in the gate pass module, **not** an accounting voucher
(phase 2 links it to the ledger):

| | |
|---|---|
| Number | `FV-000001`, `FV-000002`, … one series, given only on a successful save |
| Made | Automatically inside `gate_pass_mark_out` for a sales pass with **company pays** — so on every Out path: the guard's matching scan, a manager releasing a held pass, a backfilled paper pass (dated on the paper) |
| Carries | Voucher date (gate-out day, factory time), gate pass no., DC numbers and customers, vehicle no., mode, transporter, driver name / phone, ride ref, amount, note |
| Status | **unpaid** → **paid** (cashier) · **cancelled** (manager, reason) |
| Paid with | Paid date, paid by, cash paid (normally the voucher amount), signed-slip photo (optional), remark |
| One per pass | Unique on gate pass, so a re-run never duplicates |

Flow:

```
OUT ──► unpaid ──► paid                (cashier: Mark paid)
            └────► cancelled           (manager, reason: e.g. never collected, re-issued)
corrections while unpaid (manager, reason): amount, transporter, driver — kept in the event log
paid: frozen; only cancel + re-issue by a manager
```

- **Notification at Out** to the cashier role(s) and the pass maker: "Freight
  voucher FV-000123 · Rs 1,500 · Shahid Transport · for GP-000123 — unpaid".
- **Reminder** every morning (with the existing 09:05 overdue job) for
  vouchers unpaid for more than the setting (default 3 days).
- **Printout** (A5 / thermal-friendly, same HTML print path as the pass):
  voucher no. with QR, date, pass no., DCs, vehicle, mode, transporter, driver,
  amount in figures and words, lines for *Received by (driver) · CNIC / phone*,
  *Paid by (cashier)*, *Checked by*. The cashier can print it again at payment.
- Held, cancelled or rejected passes never get a voucher. A held pass that is
  released gets it at release, like everything else that happens at Out.

**Customer paid / customer's own vehicle**: nothing is created; the pass
history gets `freight_customer` and the log shows the pass with payer =
customer (so the dashboard can count how many loads were customer-paid).

## 4. Transporter list

A small master, **Gate Pass → Transporters** (managers), because the same
contractor and the same apps come back every day:

| Field | Note |
|---|---|
| Name, phone | |
| Kind | **Contractor** (van / bike contractor, a known person or firm) · **App** (Bykea, InDrive, Careem …) |
| Default mode | contractor van / online rickshaw / bike |
| Default rate (Rs) | optional; prefills the amount |
| Active | |
| (reserved) Ledger party | filled in phase 2 when the voucher posts to the ledger |

Typing a new name on the pass creates the transporter in the same save. The
guard never reads this table (rates are money).

### Contractor vs app — how the payee is recorded

- **Contractor van / bike contractor**: one transporter row per contractor
  (the firm or owner, e.g. *Shahid Transport*). The driver of the day is typed
  on the pass (name / phone, fields that already exist). The voucher's payee is
  the contractor; the driver is the one who signs and collects. Monthly totals
  per contractor come straight from the log.
- **Online rickshaw / bike (app)**: one transporter row **per app**, not per
  driver. The driver is a different person every ride and never comes back, so
  rows per driver would only pile up. The pass records the **ride number**
  (from the app) and the driver's name / phone from the app screen; the
  voucher prints them. Totals per app per month come from the log, and a ride
  number gives the audit trail back to the app's own receipt.
- **A regular bike rider paid per trip** (your own known person, not through
  an app): a contractor row with mode = bike.

## 5. Pages and dashboard

- **Freight Vouchers** page (`/gate-pass/freight`): tabs **Unpaid** (default,
  oldest first, with a *Mark paid* button and *Print*), **Paid**, **All**.
  Filters: date, transporter, mode, payer, status; search by FV / GP / DC /
  vehicle; Excel export. Each row: FV no., date, GP, DCs, customers, vehicle,
  mode, transporter, driver, amount, status, paid date / by.
- **Mark paid** dialog: paid date (default today), cash paid (default the
  voucher amount; a different figure needs a remark), signed-slip photo
  (optional), remark.
- **Freight dashboard** (cards on the Gate Pass dashboard, and the top of the
  Freight Vouchers page): unpaid now (count, Rs), unpaid older than the
  reminder days, paid today (Rs), this month by transporter and by mode,
  customer-paid loads this month, average freight per load.
- **Manual reconciliation**: the Paid tab, filtered by date, exported to Excel,
  is what accounts tick against the cash book. The log never changes after
  Paid, except by a logged cancel + re-issue.
- **Gate pass detail page**: Freight card with the voucher no., status and
  *Open voucher*; a *Freight not recorded* note on old passes.
- **Dispatch list / dispatch dashboard**: a **Freight** column (payer, or
  `FV-… unpaid / paid`) next to the Gate pass and Gate out columns.

## 6. Corrections

- **Unpaid**: a manager can change amount, transporter, driver, mode or ride
  ref with a reason; before / after kept in the voucher's event log; the
  printout shows "corrected".
- **Paid**: frozen. A manager cancels with a reason and, if needed, issues a
  replacement voucher from the pass (*Re-issue*). Both stay in the log.
- Changing a pass from company-pays to customer-paid after Out cancels its
  voucher (reason required).
- Nothing about the dispatch's Delivered status, invoice or COGS changes.

## 7. Roles

| Who | Can |
|---|---|
| `gate_pass_officer`, `gate_pass_manager` | Enter and edit freight on a pass before Out; print vouchers |
| `gate_pass_manager`, `super_admin` | Transporter list, corrections, cancel / re-issue, settings |
| **Cashier** — `pettycash_handler` (existing role) plus `accounting_poster` / `officer` / `manager` | Freight Vouchers page, Mark paid, print; notified at Out and by the reminder |
| `gate_pass_viewer`, `dispatch_operator`, `sales_order_manager` | Freight column and page read-only |
| `gate_security` | Nothing new; cannot read freight, voucher or transporter rows |

No new role is needed. If the cashier is not the petty-cash person, a
`freight_cashier` role can be added in the same migration.

## 8. Database (one migration + rollback, same pattern as the other gate pass phases)

- `gate_pass_transporters` — §4; read policy restricted to gate pass office
  roles, cashier roles and super admin (not `gate_security`).
- `gate_pass_freight` — one row per sales pass, written by the office:
  `gate_pass_id` (PK), `payer` (`company` / `customer` / `customer_vehicle`),
  `mode`, `transporter_id`, `transporter_name`, `amount`, `booking_ref`,
  `note`, `updated_by/at`. Same restricted read policy.
- `gate_pass_freight_vouchers` — §3: `voucher_number` (`FV-` sequence),
  `gate_pass_id` (unique), `voucher_date`, snapshot of transporter / driver /
  vehicle / mode / dispatches, `amount`, `status`, `paid_at/by`, `paid_amount`,
  `paid_photo_url`, `paid_remark`, `cancelled_at/by`, `cancel_reason`,
  `replaces_voucher_id`, reserved `ledger_voucher_id` for phase 2.
- `gate_pass_freight_voucher_events` — event log (created, corrected, paid,
  cancelled, re-issued) with before / after.
- `gate_pass_settings`: `freight_reminder_days` (default 3).
- Functions (SECURITY DEFINER, role-checked like the rest):
  `gate_pass_freight_save(p_pass_id, p_data)`, `gate_pass_transporter_save(p_data)`,
  `gate_pass_freight_voucher_create(g)` (called from `gate_pass_mark_out`),
  `gate_pass_freight_voucher_pay(p_id, p_data)`, `_correct(p_id, p_data, p_reason)`,
  `_cancel(p_id, p_reason)`, `_reissue(p_pass_id, p_reason)`.
- `gate_pass_submit`: a sales pass cannot be submitted without the payer
  chosen (and transporter + amount when company pays).
- `gate_pass_mark_out`: redefined to create the voucher for sales passes;
  every other branch unchanged.
- Views: `v_gate_pass_freight_log` (page, export, dispatch column) and
  `v_gate_pass_freight_summary` (dashboard).
- Notifications: `notify_role` to the cashier roles at Out; the morning job
  adds unpaid-overdue vouchers.
- Rollback `supabase/rollbacks/<ts>_gate_pass_freight_down.sql`: restores the
  previous `gate_pass_mark_out` and `gate_pass_submit`, drops the tables,
  functions and views.

## 9. Front end

- `GatePassFormPage`: Freight section (sales type), transporter combobox with
  "add new", amount prefill, ride ref.
- `GatePassDetailPage`: Freight card with the voucher link / status.
- `gatePass.ts` printout: the one freight line, no amount.
- New `FreightVouchersPage` (tabs, Mark paid dialog, print), `FreightVoucherPrint`
  (HTML print like the pass), `TransportersPage`; sidebar entries under Gate
  Pass; routes and `ProtectedRoute` paths for the roles above; dashboard cards.
- Dispatch pages: Freight column.
- `docs/GATE_PASS.md`: new "Freight voucher" section.

## 10. Phase 2 — ledger integration (later)

- When the cashier marks a voucher **Paid**, post the cash payment voucher
  (CPV): Dr Freight Outward, Cr Cash in Hand, party = transporter; store it in
  `ledger_voucher_id`. Paid is the right moment because that is when cash
  actually leaves.
- A **Post pending** button to post the backlog of already-paid vouchers once
  the Freight Outward account is mapped.
- Monthly-bill contractors (JV to Accounts Payable, settled through Supplier
  Payments), "company paid, recover from customer" (Dr Accounts Receivable),
  rate card per transporter × city, and distributor dispatch sheets.

## 11. Open points

1. Who is the cashier in the system: the existing `pettycash_handler` role,
   the accounting roles, or a new `freight_cashier` role?
2. Online rides: agree with the contractor-vs-app rule in §4 (one row per app,
   ride number on the pass)?
3. Reminder for unpaid vouchers: 3 days, or another figure?
