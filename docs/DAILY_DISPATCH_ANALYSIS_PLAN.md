# Daily Dispatch Analysis Report — plan (draft, 20 Oct 2026)

Status: **proposal, not built.** Mock: the "Daily Dispatch Analysis" artifact
(screen + printed A4 pages). Decisions still open are listed in section 8.

A one-day, printable report that puts **dispatch (DC)**, **store pass (SP)**
and **gate pass (GP)** side by side and lists every discrepancy or mismatching
field, so the responsible person can print it, tick each line, write the action
taken and sign it.

```
Sales order → Dispatch DC → Store pass SP → Gate pass GP → Gate out → Delivered → Invoice
                 └──────────── Daily Dispatch Analysis Report (one day, one paper) ───────────┘
```

## 1. What exists today and what is missing

`/store-pass/reconciliation` (`docs/STORE_PASS.md`) already compares, per
dispatch, the **total dozens** of DC vs SP vs GP and raises 8 codes
(`OUT_NO_SP`, `SP_NOT_OUT`, `SP_VS_GP`, `SP_VS_DC`, `SP_UNLINKED`,
`SP_CANCELLED_AFTER_ISSUE`, `CROSS_DAY`, `DC_PENDING`). Its print is a plain
table dump.

It does **not** check:

| Gap | Example it misses |
|---|---|
| Product mix | DC 40 dz = 20 dz size 5 + 20 dz size 4; store gave 30 + 10. Totals match, goods are wrong |
| Cartons | Dozens match, cartons differ (dropped from discrepancies in `20261031120000_store_pass_recon_dozens_only.sql`) |
| Vehicle | DC says `LES-4521`, gate pass `LES-4512`, guard saw `LES-4512` |
| Driver / customer | Gate pass party ≠ dispatch customer; driver differs |
| Dispatch changed after the gate pass | Gate pass lines (snapshot) ≠ dispatch as it is now |
| Status / dates | DC marked *Delivered* with no gate out; delivery date ≠ gate-out date |
| Invoice | Went out, not invoiced; invoice dozens ≠ dispatch dozens |
| Gate events | Held / released short (with reason), old pass scanned again, paper backfill, gate pass cancelled after the store issued |
| Timing | SP issued 6 h before the vehicle left; DC made, store issued next day |
| Sign-off | Nobody records that the day was reviewed |

## 2. The report

**Route** `/store-pass/daily-report` (Store Pass group) and the same page under
the Gate Pass group for gate pass managers. One day at a time (Pakistan time),
with ‹ › to move between days. The existing reconciliation page gets a
**Daily report** button.

### Screen

- Header: date, generated at, **Review status** (Not reviewed / Reviewed by …).
- **Result strip**: `3 high · 4 medium · 2 info open` plus a one-line verdict
  (*Not clear*: open high items; *Clear with notes*; *Clear*).
- **Totals**: DC / SP / GP printed / GP counted / Out / Invoiced, each with
  count, dozens and cartons. Differences shown in red under each column.
- **Check board**: one tile per check category (Quantity, Products, Vehicle &
  driver, Status & dates, Invoice, Gate events, Timing) with pass / fail count.
- Tabs: **Exceptions** (default) · **Dispatch register** · **Products** ·
  **Gate events** · **Carry forward**.
- **Explain** on any exception (existing `store_pass_recon_notes`, extended to
  the new codes). **Mark day reviewed** (section 6).
- **Print** opens the A4 report (section 3). **Excel** exports all tabs.

### Exceptions tab

One row per (dispatch, check). Sorted high → medium → info, then DC number.
Columns: `#`, severity, check, DC, SP, GP, customer, **expected**, **found**,
**difference**, explanation (if any). Filters: severity, category,
open / explained.

### Dispatch register tab

Every dispatch of the day, one row: DC, customer, vehicle, DC dz/ctn,
SP dz/ctn, GP dz/ctn (counted), out time, invoice no., then one ✓ / ✗ cell per
category so a clean dispatch reads as a row of ticks.

### Products tab

Per product for the day (existing `store_pass_reconcile_products`) plus, for
each dispatch with `ITEM_MIX`, the per-product breakdown DC / SP / GP.

## 3. Printed report (A4 landscape)

`printDocument()` from `src/lib/printDocument.ts`, its own stylesheet, black
and white safe (severity shown as `H` / `M` / `I` letters and a heavy left rule,
not colour alone). Every page: company, report title, date, page `n of N`,
report reference `DDA-2026-10-20`.

| Page | Content |
|---|---|
| 1 | Header · result verdict · totals table · check board · flow funnel (DC → SP → GP → Out → Invoiced) |
| 2… | **Exceptions register** with two blank columns: **Action taken / remarks** and **Initials** for handwriting |
| next | **Dispatch register** (all dispatches, ✓ / ✗ per check) |
| next | **Product detail** for mismatched dispatches only |
| next | **Gate events** (held, released, rescan, backfill, cancelled) and **Carry forward** (still inside, drafts, unlinked, unexplained from earlier days) |
| last | **Sign-off**: Store keeper · Dispatch operator · Gate in-charge · Reviewed by (manager) — name, signature, date; overall *Satisfactory / Not satisfactory* tick boxes |

Print options: *Exceptions only* (pages 1, 2 and sign-off — the usual daily
paper) or *Full report*.

## 4. Checks

Existing codes keep their meaning. New codes are added to
`store_pass_code_severity()` so Explain, the 20:30 notice and the counts treat
them the same way.

| Code | Category | Rule | Severity |
|---|---|---|---|
| `OUT_NO_SP` | Quantity | *existing* | High |
| `SP_NOT_OUT` | Quantity | *existing* | High |
| `SP_VS_GP` | Quantity | *existing* (dozens) | High |
| `SP_VS_DC` | Quantity | *existing* (dozens) | Medium |
| `GP_VS_DC` **new** | Quantity | Gate pass printed dozens ≠ dispatch now (dispatch edited after the gate pass and not refreshed) | High |
| `ITEM_MIX` **new** | Products | Totals match, but per product DC / SP / GP differ (SP lines with a product only) | High |
| `CTN_DIFF` **new** | Quantity | Dozens match, cartons differ between any two of DC / SP / GP | Medium |
| `GP_SHORT_RELEASED` **new** | Gate events | Guard counted less than printed, released by a manager (shows reason, who) | Medium |
| `SP_LINE_NO_PRODUCT` **new** | Products | SP line typed without a product: not compared item-wise | Info |
| `VEHICLE_MISMATCH` **new** | Vehicle & driver | Normalised plate (upper case, no spaces / dashes) of DC ≠ GP, or GP ≠ guard-seen plate | High (guard ≠ GP), Medium (DC ≠ GP) |
| `DRIVER_MISMATCH` **new** | Vehicle & driver | DC driver ≠ GP driver (normalised name) | Medium |
| `CUSTOMER_MISMATCH` **new** | Vehicle & driver | GP party ≠ DC customer | High |
| `PLAN_NO_MISMATCH` **new** | Products | SP plan no. is a DC number other than the linked DC | Medium |
| `DELIVERED_NO_OUT` **new** | Status & dates | DC *Delivered* / *In transit* but no gate out | High |
| `DELIVERY_DATE_DIFF` **new** | Status & dates | Actual delivery date ≠ gate-out date | Medium |
| `NOT_INVOICED` **new** | Invoice | Out, no live invoice at report time (shown softer while the day runs) | Medium |
| `INVOICE_QTY_DIFF` **new** | Invoice | Invoice dozens ≠ dispatch dozens | High |
| `GP_CANCELLED_AFTER_SP` **new** | Gate events | Sales GP cancelled after the SP was issued | Info |
| `RESCAN` **new** | Gate events | Old pass scanned again (from `rescan_attempt` events) | High |
| `BACKFILL` **new** | Gate events | Sales pass entered from paper | Info |
| `SLOW_SP_TO_OUT` **new** | Timing | SP issued → gate out over the limit (default 4 h) | Info |
| `SLOW_DC_TO_SP` **new** | Timing | DC made → SP issued over the limit (default 24 h) | Info |
| `SP_UNLINKED`, `SP_CANCELLED_AFTER_ISSUE`, `CROSS_DAY`, `DC_PENDING` | | *existing* | as today |

Freight (company pays without a voucher, amount above the transporter's
default rate) is left out of v1: freight amounts are hidden from store and
gate-security roles. It can be added as a section that only cashier / gate pass
managers see.

## 5. Database

Migration `2026xxxx_dispatch_daily_analysis.sql` (+ rollback):

- `dispatch_daily_analysis(p_date date) RETURNS jsonb` — `SECURITY DEFINER`,
  role-checked like `store_pass_reconcile`. Builds on
  `store_pass_reconcile(p_date, p_date)` and adds the new codes. Returns
  `{ summary, checks[], dispatches[], items[], products[], gate_events[], carry_forward[], review }`.
  Item comparison: DC `sales_dispatch_items` ↔ GP `gate_pass_items.dispatch_item_id`
  (exact), SP `store_pass_items.product_id` ↔ DC product (by product).
- `store_pass_code_severity()` extended with the new codes.
- `dispatch_analysis_settings` (super admin): timing limits, whether
  `NOT_INVOICED` counts before the next morning.
- `dispatch_daily_reviews` (`report_date` PK, `reviewed_by`, `reviewed_at`,
  `verdict`, `remarks`, `open_high_at_review`) and
  `dispatch_daily_review_save(p_date, p_verdict, p_remarks)`.
- Cron: the existing 20:30 discrepancy notice links to the new report; a 10:00
  next-day reminder to the reviewer when yesterday is not reviewed.

Read-only, no stock or ledger effect. Prices are never shown.

## 6. Review and sign-off

- **Mark day reviewed** (store pass manager, gate pass manager, super admin):
  verdict *Satisfactory / Not satisfactory*, remarks. Stores the open-high count
  at that moment. Allowed with open items (the verdict says so).
- The printed sign-off block carries the digital review when it exists
  ("Reviewed in system by … at …") and blank lines for wet signatures.
- Dashboard card: *Days not reviewed (last 7)*.

## 7. Roles

| Role | Sees | Can |
|---|---|---|
| `store_pass_manager`, `gate_pass_manager`, `super_admin` | Full report | Explain, mark reviewed, print, export |
| `store_pass_officer`, `store_pass_viewer`, `gate_pass_viewer` | Full report | Print, export |
| `dispatch_operator`, `sales_order_manager` | Full report | Print, export (they fix DC / invoice causes) |
| `gate_security` | — | — |

## 8. Open decisions

1. **Checks in v1** — all of section 4, or start with quantity + products +
   vehicle and add invoice / timing later?
2. **Sign-off** — paper only, or paper plus the in-system *Mark day reviewed*
   (recommended)?
3. **Who is the reviewer** that gets the next-morning reminder?
4. **Limits** — SP → Out 4 h and DC → SP 24 h; carton differences Medium or Info?
5. **Scope** — domestic dispatches only (as the store pass), or also export /
   online dispatches without a store pass (gate + invoice checks only)?
6. **Urdu** — Urdu headings on the printed page for the store and gate staff?

## 9. Phases

1. Database function + new codes, screen with Exceptions and Dispatch register,
   A4 print (exceptions-only and full).
2. Products / gate events / carry-forward tabs, review sign-off, reminders,
   settings.
3. Weekly / monthly trend (discrepancies per category, per store keeper,
   per transporter).
