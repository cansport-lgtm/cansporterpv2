# Dispatch freight → cash voucher at gate out — plan (draft, 6 Oct 2026)

Every dispatch leaves on a hired vehicle: a contractor van, an online rickshaw
(Bykea / InDrive / Careem) or a bike. The driver is paid in cash at the gate,
and today that payment is written by hand afterwards. Sometimes the customer's
own van collects the stock and nothing is paid.

Proposal: the office writes the freight on the **sales gate pass** while making
it (who pays, how it goes, which transporter, how much). When the guard scans
the pass and the vehicle goes **Out**, the system posts the **cash payment
voucher (CPV)** by itself, prints it for the driver's signature, and tells the
cashier. If the customer paid or brought their own vehicle, nothing is posted
and the pass just records that.

```
Sales order → Dispatch DC (office) → Gate pass GP (one vehicle, 1..n DCs)
                                          │  office fills "Freight": payer, mode, transporter, amount
                                          ▼
                              guard scans → count matches → OUT
                                          │
                     ┌────────────────────┴────────────────────┐
             payer = company                            payer = customer
   CPV posted automatically                              no voucher
   Dr Freight Outward  /  Cr Cash in Hand                pass shows "Customer paid"
   party = transporter · ref = GP number                 (or "Customer's own vehicle")
   cashier notified · voucher printed for signature
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
| Mode | Contractor van / Online rickshaw / Bike / Own vehicle | Required when company pays |
| Transporter | Pick from the transporter list, or type a new name (and phone) | Required when company pays; a new name is saved to the list |
| Amount (Rs) | > 0 | Required when company pays |
| Online booking ref | free text | Optional (the Bykea / InDrive ride number) |
| Note | free text | Optional |

- Prefilled: transporter from the DC's `transporter_name`; amount from the
  transporter's **default rate** (see §4) if one is set.
- Editable while the pass is draft or approved (not yet out). After out, only a
  **correction** (see §6).
- Shown on the pass detail page and on the printout as a single line
  ("Freight: company pays · Contractor van · Shahid Transport" or "Freight:
  customer paid"). The **amount is not printed** on the gate pass; it is on the
  cash voucher.
- Old passes (made before this goes live) are "Freight not recorded" and are
  never posted.

## 3. What happens at Out

Inside the existing `gate_pass_mark_out` (so it fires on every path that
already sets Out: the guard's matching scan, a manager releasing a held pass,
and a backfilled paper pass), for a **sales** pass with **company pays**:

1. Post one **CPV** dated the gate-out day (factory time; the paper date for a
   backfill):

   | | Account | Dr | Cr | Party |
   |---|---|---|---|---|
   | 1 | **Freight Outward** (new default-account slot `freight_outward`) | amount | | transporter |
   | 2 | **Cash in Hand** (existing slot `default_cash`) | | amount | |

   Narration: `Freight GP-000123 · DC-00456, DC-00457 · KHI-1234 · Online rickshaw · Shahid Transport`.
   `source_module = 'gate_pass_freight'`, `source_reference_id = gate pass id`.
   Posted once only (unique on source + pass), so a re-run never duplicates.
2. Save the voucher id and number on the pass, log `freight_posted` in the
   pass history.
3. Notify the cashier roles (`accounting_poster`, `accounting_officer`,
   `accounting_manager`) and the pass maker: "Cash voucher CPV-202610-0031 ·
   Rs 1,500 to Shahid Transport for GP-000123".
4. If the Freight Outward or Cash account is not mapped, the pass **still goes
   Out** (the vehicle must not be stopped by accounting setup); the pass is
   flagged "freight voucher not posted" and managers are notified. A manager
   posts it later from the pass page once the accounts are mapped.

With **customer paid** or **customer's own vehicle**: nothing is posted; the
pass history gets `freight_customer`.

Held, cancelled or rejected passes never post. A pass that is held and later
released posts at release, like everything else that happens at Out.

The cashier pays the driver from the gate-out day's cash. The voucher print
(existing voucher view) gets a **Received by (driver) signature** line and the
pass number, so the signed copy is the cash proof.

## 4. Transporter list

A small master, **Gate Pass → Transporters** (managers), because the same
contractor and the same rickshaw apps come back every day:

| Field | Note |
|---|---|
| Name, phone | |
| Default mode | contractor van / online rickshaw / bike |
| Default rate (Rs) | optional; prefills the amount |
| Settlement | **Cash at gate** (phase 1) · **Monthly bill** (phase 2) |
| Ledger party | created automatically in `accounting_parties` (type `supplier`) the first time; used on the voucher |
| Active | |

Typing a new name on the pass creates the transporter with the ledger party in
the same save. The guard never reads this table (rates are money).

## 5. Reports

- **Freight Register** page (`/gate-pass/freight`, gate pass managers,
  officers read-only, accounting roles): one row per out sales pass — date,
  GP, DCs, customers, vehicle, mode, transporter, payer, amount, voucher no.
  (link), not-posted flag. Filters by date, transporter, payer, mode; totals
  per transporter and per mode; Excel export.
- **Gate Pass dashboard**: today's freight cash (count and Rs), passes with a
  voucher not yet posted.
- **Dispatch list**: a **Freight** column (payer / amount) next to the existing
  Gate pass and Gate out columns, read from the pass of that dispatch.
- Accounting pages need nothing new: the CPV already appears in Cash Book, Day
  Book, Vouchers, the party ledger of the transporter and Expenses analysis
  under Freight Outward. The voucher view shows "Source: Gate pass GP-000123"
  with a link to the pass.

## 6. Corrections and cancellation

- **Wrong amount or transporter after Out** (manager only, with a reason):
  the original CPV is reversed with the existing reversal (status `reversed` +
  mirror voucher) and a new CPV is posted; both stay in the ledger and in the
  pass history. Blocked if the period is closed (existing trigger).
- **Changed to customer paid after Out**: reversal only, no new voucher.
- A pass is never cancelled after Out today; that stays so.
- Nothing about the dispatch's Delivered status, invoice or COGS changes.

## 7. Roles

No new roles. Existing ones decide:

| Who | Can |
|---|---|
| `gate_pass_officer`, `gate_pass_manager` | Enter and edit freight on a pass before Out |
| `gate_pass_manager`, `super_admin` | Transporter list, corrections after Out, post a voucher that failed |
| `accounting_poster` / `officer` / `manager` | Get the notification, see the register, print the voucher |
| `gate_security` | Nothing new; cannot read freight or transporter rows |
| `gate_pass_viewer` | Register read-only |

## 8. Database (one migration + rollback, same pattern as the other gate pass phases)

- `gate_pass_transporters` — §4; read policy restricted to gate pass office
  roles, accounting roles and super admin (not `gate_security`).
- `gate_pass_freight` — one row per sales pass: `gate_pass_id` (PK), `payer`
  (`company` / `customer` / `customer_vehicle`), `mode`, `transporter_id`,
  `transporter_name`, `amount`, `booking_ref`, `note`, `voucher_id`,
  `posted_at`, `post_error`, `updated_by/at`. Same restricted read policy.
  Unique on `voucher_id`.
- `accounting_default_accounts`: new slot `freight_outward`, added to
  `DefaultAccountsPage` so it can be mapped to a Freight / Cartage Outward
  expense head.
- Functions (SECURITY DEFINER, role-checked like the rest):
  `gate_pass_freight_save(p_pass_id, p_data)`, `gate_pass_transporter_save(p_data)`,
  `gate_pass_freight_post(p_pass_id)` (called from `gate_pass_mark_out`; also
  callable by a manager for a failed post), `gate_pass_freight_correct(p_pass_id, p_data, p_reason)`.
- `gate_pass_submit`: a sales pass cannot be submitted without the payer
  chosen (and transporter + amount when company pays).
- `gate_pass_mark_out`: redefined to call `gate_pass_freight_post` for sales
  passes; every other branch unchanged.
- View `v_gate_pass_freight_register` for the page and the dispatch column.
- Rollback `supabase/rollbacks/<ts>_gate_pass_freight_down.sql`: restores the
  previous `gate_pass_mark_out` and `gate_pass_submit`, drops the two tables,
  the functions and the view. Posted vouchers are kept (ledger history).

## 9. Front end

- `GatePassFormPage`: Freight section (sales type), transporter combobox with
  "add new", amount prefill.
- `GatePassDetailPage`: Freight card with voucher link, "not posted" banner
  with a **Post now** button, **Correct freight** dialog (managers).
- `gatePass.ts` printout: the one freight line, no amount.
- New `FreightRegisterPage`, `TransportersPage`; sidebar entries under Gate
  Pass; routes and `ProtectedRoute` paths for the roles above.
- `DefaultAccountsPage`: the `freight_outward` slot.
- `VoucherViewDialog`: source link to the pass, driver signature line on print.
- Dispatch pages: Freight column.
- `docs/GATE_PASS.md`: new "Freight and cash voucher" section.

## 10. Phase 2 (not in the first build)

- **Monthly bill transporters**: at Out post a JV (Dr Freight Outward, Cr
  Accounts Payable – transporter) instead of cash; settle through the existing
  Supplier Payments page. The transporter's `settlement` field decides.
- **Recover from customer**: "Company paid, charge the customer" posts the
  cash out and Dr Accounts Receivable (customer) so it rides the customer's
  ledger and invoice.
- **Rate card**: rate per transporter × city / zone, prefilling the amount and
  warning when the entered amount is above the card.
- **Distributor dispatch sheets**, once they get a gate pass.

## 11. Decisions needed before building

1. Post the CPV **at the moment of gate out** (recommended: matches "scan →
   voucher", and the vehicle is already gone) — or create it as a pending item
   that the cashier confirms when the driver is actually paid?
2. Freight is entered by the **pass maker in the office** (recommended) — or
   should the dispatch operator put it on the DC and the pass copy it?
3. Online rickshaw / bike rides: one transporter per **app** (Bykea, InDrive…)
   with the ride number in the booking ref — or one row per driver?
4. Keep the amount **off the gate pass printout** (recommended) — or print it?
5. Which expense head to map to `freight_outward` (an existing one such as
   Cartage Outward, or a new account).
