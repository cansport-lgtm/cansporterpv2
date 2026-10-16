# Inward freight voucher on the GRN — plan (6 Oct 2026)

**Built 6 Oct 2026** as `supabase/migrations/20261014120000_grn_freight.sql`
(rollback in `supabase/rollbacks/`). What is live is summarised in
`docs/GATE_PASS.md` under *Inward freight on the GRN*.

Decisions taken: freight is entered **on the GRN** by **whoever makes the
GRN**, who can also **print the voucher** from there; one truck carrying
several POs → the trip is entered on one GRN and the others say **"On another
GRN"**; **"to pay" freight recovered from the supplier** is a choice of its
own; inward freight is an **expense** (Freight Inward) in the ledger.

Same freight voucher system as the sales gate pass (`docs/DISPATCH_FREIGHT_VOUCHER_PLAN.md`,
live in `20261012130000_gate_pass_freight.sql`), now for **goods coming in**
against a purchase order.

A supplier's delivery arrives in one of these ways:

| Case | Who carries | Who pays freight | What happens today |
|---|---|---|---|
| A | Supplier's own van / freight included in the price | Nobody separately | Nothing — correct |
| B | Supplier hires, and **charges freight on his bill** | Company, through the supplier's invoice | Typed in *Transportation Cost* → added to the GRN total → supplier payable. Correct |
| C | **We hire / pay** the transporter (contractor van, Bykea / rickshaw, goods company bilty "to pay") | Company, cash to the driver | Either written by hand, **or typed in *Transportation Cost*, which wrongly adds it to the supplier's payable** (Accounts Payable to the supplier is overstated by cash we paid someone else) |

Case C is the one that needs the voucher, exactly like a company-paid
dispatch.

```
PO → Gate inward GIN (vehicle at gate, transporter name) → GRN (store counts goods)
                                                            │ office fills "Freight": who pays, mode, transporter, amount
                                                            ▼
                                     GRN saved ─┬─ company paid transporter → FV-000124 (UNPAID), "Inward"
                                                │      cashier notified → driver collects → cashier marks PAID
                                                ├─ supplier billed it → amount added to the GRN total (as today)
                                                └─ supplier's own vehicle / included → nothing
```

## 1. What we reuse from the gate pass freight (no second system)

- **Same voucher series** `FV-…`, same table, same statuses (unpaid → paid /
  cancelled), same corrections, cancel and re-issue, same event log.
- **Same transporter list** (Gate Pass → Transporters). A contractor who brings
  raw material in the morning and takes a dispatch out in the evening is one
  row, and the cashier can **Pay selected** across both inward and outward
  trips on one statement `FPS-…`.
- **Same Freight Vouchers page**, print, reminder job and dashboard — with a
  new **Direction** (Outward · Inward) filter and column.
- Same roles for the cashier side (`pettycash_handler` + accounting roles).

## 2. Where it is entered: the GRN form

A **Freight** section on Goods Receipt (`/purchase/grn`), replacing the single
*Transportation Cost* box:

| Field | Values | Rule |
|---|---|---|
| Who pays | **Supplier's own vehicle / included** · **Supplier billed** · **Company paid transporter** | Required on a new GRN |
| Amount on supplier's bill (Rs) | > 0 | Only for *Supplier billed*; this is today's `transportation_cost`, added to the GRN total as now |
| Mode | Contractor van / Online rickshaw / Bike / Goods company (bilty) | Required when company paid |
| Transporter | Pick from the list or type a new name (+ phone) | Required when company paid; new name saved to the list |
| Driver name / phone, vehicle no. | Prefilled from the gate inward entry | Printed on the voucher |
| Amount paid (Rs) | > 0 | Required when company paid; prefilled from the transporter's default rate |
| Ride / bilty no. | free text | App ride number or goods-company bilty |
| Note | free text | Optional |

- Prefill from the chosen **gate inward entry** (vehicle, driver, transporter
  name) — the office does not retype what the gate already recorded.
- **Company paid freight is NOT added to the GRN total** and never reaches the
  supplier's payable. The GRN view shows it separately: "Freight: company paid
  · Shahid Transport · FV-000124 (unpaid)".

## 3. The voucher

- Made **automatically when the GRN saves** (inside the database, same
  transaction as the GRN — an insert trigger on `goods_receipt_notes`), only for
  *Company paid transporter*. One live voucher per GRN.
- Voucher date = GRN receipt date. Carries GRN no., PO no., supplier, gate
  inward no., vehicle, mode, transporter, driver, ride / bilty no., amount.
- Printout: same A5 slip as the outward voucher, titled **Freight voucher —
  Inward**, showing GRN / PO / supplier instead of GP / DC / customer.
- Notification to the cashier roles and the GRN maker; included in the 09:05
  unpaid-overdue reminder.
- **GRN deleted**: an unpaid voucher is cancelled automatically (reason "GRN
  deleted"); if the voucher is **paid**, the GRN delete is blocked until a
  manager cancels the voucher.
- Correcting payer / amount after the GRN is saved: through the voucher's
  existing *Correct* / *Cancel* / *Re-issue* (manager, reason logged), plus a
  small *Edit freight* on the GRN view for the same roles.

## 4. Database (one migration + rollback)

- `gate_pass_freight_vouchers`:
  - `gate_pass_id` becomes nullable; new `grn_id` → `goods_receipt_notes`,
    `direction` (`outward` / `inward`), check: exactly one of the two set.
  - Snapshot columns for inward: `grn_number`, `po_number`, `supplier_name`,
    `gate_inward_number`.
  - Unique live voucher per GRN (like the per-pass one).
- New `grn_freight` (one row per GRN, like `gate_pass_freight`): `grn_id`,
  `payer` (`supplier_vehicle` / `supplier_billed` / `company`), `mode`,
  `transporter_id`, `transporter_name`, `amount`, `booking_ref`, `note`.
  Same restricted read policy (store / guard never see amounts they don't today).
- Mode list gains `goods_company` (bilty).
- Functions: `grn_freight_save(p_grn_id, p_data)`; voucher creation shared
  with the outward one (`..._voucher_create` split into a common insert);
  `pay`, `pay_selected`, `cancel`, `reissue` work unchanged on either direction.
- Views `v_gate_pass_freight_log` / summary: union in the inward vouchers with
  `direction`.
- Old GRNs: freight "not recorded"; their `transportation_cost` stays as it is.
- Rollback restores the previous functions and drops the new column / table.

## 5. Front end

- `GoodsReceiptPage`: Freight section (reusing `FreightSection` where it fits).
- `GRNViewDialog`: freight line + voucher link and status.
- `FreightVouchersPage`: Direction filter / column, GRN / PO / supplier in the
  row, inward print layout; Excel export includes direction.
- `TransportersPage`: a transporter's trips show inward and outward together.
- Dashboard cards: inward freight this month, by supplier, freight as % of
  purchase value; Purchase dashboard gets an "unpaid inward freight" card.
- Docs: `docs/GATE_PASS.md` freight section and `docs/GATE_INWARD.md`.

## 6. Accounting

- Supplier GRN posting (`postGRNVoucher`) is unchanged in shape: supplier
  payable = items + supplier-billed freight only. Company-paid freight is out of
  it — this fixes today's overstatement when cash freight is typed in.
- Phase 2 (with the outward phase 2): when the cashier marks paid → CPV
  **Dr Freight Inward (Carriage Inward)**, Cr Cash, party = transporter.

## 7. Decisions (confirmed 6 Oct 2026)

1. Entered on the GRN; the voucher prints from the GRN (toast after saving,
   Freight column on the list, Freight block on the GRN view).
2. One truck, several POs: amount on one GRN, the others **On another GRN**
   (picks a GRN of the last 14 days with company-paid freight). A GRN that
   others point at cannot be switched away from company-paid.
3. **Company paid, recover from supplier** added: inward voucher as usual,
   and the GRN's purchase posting splits the credit — Accounts Payable
   (amount − freight) and **Freight Inward** (freight). Needs the *Freight
   Inward (expense)* slot mapped on Accounting → Default Accounts;
   `syncGRNToLedger` keeps the split in step after edits.
4. Inward freight is an expense: the later posting of a paid voucher is
   Dr Freight Inward, Cr Cash. Until then the cash book entry for every inward
   freight payment should go to Freight Inward; recovered ones net to nil
   against the GRN credit.
5. Whoever can make a GRN (`purchase` create permission, purchase officer /
   manager, store operator, accounting officer, admin) records the freight and
   reads / prints inward vouchers. Changing it later: the GRN maker or a
   purchase / gate pass manager, with a reason. Cancelling an inward voucher:
   gate pass manager or purchase manager.

Not built in this round: the Purchase dashboard "unpaid inward freight" card
and "freight as % of purchase value" (§5). The Freight Vouchers page shows
inward totals for the month next to the outward ones.
