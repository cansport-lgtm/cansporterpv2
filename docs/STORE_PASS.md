# Store Pass (finished goods handed over for dispatch)

A **store pass** records the finished goods the FG store hands over at the
loading dock, *before* the vehicle reaches the gate. One number series:
`SP-000001`, `SP-000002`, … given only when a pass saves successfully.

```
Sales order → Dispatch DC → Store pass SP (store keeper) → Gate pass GP → Gate out → Delivered
                                   ↓                                   ↓
                              Daily store ↔ gate reconciliation (step 2)
```

Database: `supabase/migrations/20261008120000_store_pass_roles.sql` (roles),
`20261008120100_store_pass.sql` (passes, tracking),
`20261008120200_store_pass_reconciliation.sql` (reconciliation, gate check
notice, daily notification), `20261009120000_store_pass_simplify.sql` (the
simplified pass described below) and `20261009130000_store_pass_link_roles.sql`
(who links passes to dispatches) and `20261010120000_store_pass_one_to_one.sql`
(one pass ↔ one dispatch ↔ one gate pass; corrections by super admin). Rollbacks in `supabase/rollbacks/`. Plan and
decisions: `docs/STORE_PASS_PLAN.md`.

## What a pass is

The store keeper does not know the vehicle or the driver and does not pick
system dispatches. A pass is four things:

| | |
|---|---|
| **Dispatch plan no.** | Free text, required — the number on the dispatch plan (a planner version `DPV-000012`, or the dispatch number `DC-00412` when known). It tells the dispatch operator which dispatch to link the pass to; a pass whose plan number is a DC number is offered first |
| **Items** | Typed by the keeper: description (free text), optional product, dozens, cartons, remark. At least one item with a quantity |
| **Handed over to** | The name of the person the goods were handed to (loader / driver) — required to issue |
| **Photo** | Of the stock at the loading dock — required to issue |
| Approval | None — tracking only. Issuing stamps who and when |
| Stock | **None.** The dispatch already moves finished goods (WIP ledger FG level, COGS). The store pass is a control document |
| Prices | Never stored or shown |

**Linking to the dispatch sheet** (the system dispatch, DC) is what Dispatch
Tracking, the Gate Check notice and the daily reconciliation compare on. It is
**not the store keeper's job**: the keeper only makes and issues the pass. The
**dispatch operator** links it, from the Domestic Dispatch page — the **Store
pass** column has a **Link** button per dispatch (or **Change** when it is
already on a pass) that opens the list of live passes, the one whose plan number
is this DC first, with items, hand-over person and issue time. Issuing a pass
with no link sends the dispatch operators a notification. Store pass managers
and gate pass managers can also link, from the pass page (**Link to dispatch**).
An issued pass with no link shows in the reconciliation as **Not linked to a
dispatch** until it is.

**One to one.** A store pass links to **one** dispatch, a dispatch is on **one**
live store pass, and a dispatch is on **one** sales gate pass (a sales gate pass
covers one dispatch, see `docs/GATE_PASS.md`):

```
SP-000012  →  DC-00412  →  GP-000871
```

**Wrong link = correction, super admin only.** The operator links an unlinked
pass once. After that, changing the dispatch or removing the link (**Correct
linked dispatch** on the pass page, **Change** / **Unlink** in the Store pass
column) is only offered to, and only accepted from, a super admin. The history
shows the correction (`Link corrected: DC-00412 → DC-00415`).
(`20261010120000_store_pass_one_to_one.sql`.)

Figures per dispatch: the linked pass gives the dispatch its totals. (Passes
linked to several dispatches before the one-to-one rule cannot be split: those
dispatches show the pass number without figures and are not checked store ≠
gate until a super admin corrects the link.)

## Flow

```
draft → issued → (cancelled)
```

- **Draft**: the keeper can edit items, the plan number, the hand-over and the
  photo, and cancel.
- **Issued**: goods have been handed over; the pass is frozen. Only a store
  pass manager (or super admin) can cancel it, with a reason. The pass can be
  linked after issue; a link, once made, is changed only by a super admin.

## Pages (sidebar group **Store Pass**, module `store_pass`)

| Page | Route | What it shows |
|---|---|---|
| Dashboard | `/store-pass/dashboard` | Today's dispatches, store passes issued and gate outs; issued-but-waiting (with hours); dispatches with no store pass; held at gate; open discrepancies of the last 7 days; recent passes |
| Store Passes | `/store-pass/passes` | Register with date range, status and search; Excel export; cards for issued today, issued-but-no-gate-pass, dispatches with no store pass, held at gate |
| New Store Pass | `/store-pass/new` | Dispatch plan no. → items (description, optional product, dz, ctn, remark) → handed over to, photo of the stock, remarks → **Issue** or **Save as draft**. No linking here |
| Store pass | `/store-pass/passes/:id` | Items, the linked dispatch with its gate pass and gate-out time, details, the photo, history; Print, Edit / Issue (draft), Link to dispatch (linker roles; Correct linked dispatch: super admin), Cancel |
| Dispatch Tracking | `/store-pass/tracking` | One row per domestic dispatch: DC → SP → GP → Out → Delivered as a stage strip with the hours between steps; stage chips as filters; open stages shown whatever their date; Excel export |
| Daily Reconciliation | `/store-pass/reconciliation` | See below |

Gate pass managers see **Dispatch Tracking** and **Store ↔ Gate Reconciliation**
in the Gate Pass group too.

## Daily Reconciliation

Pick a day (Pakistan time; a range is also allowed). Every domestic dispatch
that belongs to the day — dated in it, store-issued in it, gone out of the gate
in it, or whose issued store pass was cancelled in it — is one row with the
dispatch (DC), store pass (SP) and gate pass (GP) figures. A store pass covers a
vehicle, but every line belongs to one dispatch item, so the comparison stays
per dispatch.

| Code | Shown as | Meaning | Severity |
|---|---|---|---|
| `OUT_NO_SP` | Out without store pass | Left the gate, no issued store pass | High |
| `SP_NOT_OUT` | Issued, not out | Store handed over, not out of the gate (shown softer while the day is still running) | High |
| `SP_VS_GP` | Store ≠ gate | Store issued ≠ counted at the gate (printed figures when nothing was counted) | High |
| `SP_VS_DC` | Store ≠ DC | Store handed over ≠ the dispatch as it is now (single-linked passes) | Medium |
| `SP_UNLINKED` | Not linked to a dispatch | Issued pass with no linked dispatch; nothing to compare yet — the dispatch operator links it from the Domestic Dispatch page | Medium |
| `SP_CANCELLED_AFTER_ISSUE` | Issued pass cancelled | An issued store pass was cancelled | Info |
| `CROSS_DAY` | Cross-day | Issued on one day, out on another | Info |
| `DC_PENDING` | Pending | Dispatch made, nothing issued or out yet | Info |

- **Explain**: a store pass manager, gate pass manager or super admin marks a
  code on a dispatch Explained with a note (`store_pass_recon_notes`); it no
  longer counts as open. Reopen removes the note.
- **By product** tab: per SKU for the day — dispatched, store issued, gate
  (counted where counted), store − gate, DC − store.
- **Export** (Excel, both tabs) and **Print**.
- **Gate setting** (super admin, on this page): what happens when a sales gate
  pass has a domestic dispatch with no issued store pass —
  `off` (nothing), `warn` (**default**: the vehicle may go; the event
  `no_store_pass` is logged on the gate pass and the store pass managers are
  notified) or `block` (the gate check is refused until a store pass is issued).
  The Gate Check page shows the notice before the guard counts.
- **Daily notice**: at 20:30 Pakistan time (`store-pass-discrepancies` cron)
  store pass managers and gate pass managers get one notification with the
  day's open high discrepancies, linking to the page for that day.

## Effects on existing pages

- **Domestic Dispatch** list and **Dispatch Dashboard**: one extra column,
  **Store pass** (SP number and issue time, or —), next to Gate pass / Gate out.
  On the Domestic Dispatch list, linker roles (the dispatch operator) also get
  the **Link** / **Change** button there, which opens the store pass picker.
- **New Gate Pass (Sales)**: the dispatch picker shows each dispatch's store
  pass (`SP-… · 14:05`, `draft`, or **No store pass**).
- **Gate Check**: the store-pass notice (warn / block) on a sales pass, per the
  setting above. `gate_pass_gate_check` is wrapped once more
  (`20261008120200_store_pass_reconciliation.sql`); counting, holding and
  releasing are unchanged.
- Nothing in dispatch, invoicing or COGS changes.

## Database

Tables (read-only to the app; writes through `store_pass_*` functions):
`store_passes` (`dispatch_plan_no`, `received_by_name` = handed over to,
`photo_path`), `store_pass_dispatches` (the optional links to system
dispatches), `store_pass_items` (free-text lines: `description`, optional
`product_id`, `quantity` dz, `packages` ctn), `store_pass_events`.

Views: `v_dispatch_store_pass` (live store pass per dispatch),
`v_store_gate_tracking` (one row per domestic dispatch with DC, SP and GP
figures, gate counts and the `stage` reached: `no_store_pass`, `draft`,
`issued`, `on_gate_pass`, `held`, `out`, `delivered`, `returned`).

Functions: `store_pass_save(p_id, p_data, p_issue)` (never links),
`store_pass_issue` (notifies the dispatch operators when the pass has no link),
`store_pass_cancel`, `store_pass_link_dispatches(p_id, p_dispatch_ids)` (linker
roles: `store_pass_can_link()`), and for the operator's dialog
`store_pass_link_candidates(p_dispatch_id)`,
`store_pass_attach_dispatch(p_store_pass_id, p_dispatch_id)`,
`store_pass_detach_dispatch(p_dispatch_id)`;
`store_pass_reconcile(from, to)`,
`store_pass_reconcile_products(from, to)`, `store_pass_recon_resolve`,
`store_pass_recon_reopen`, `store_pass_settings_save`,
`store_pass_gate_status(gate_pass_id)`. Internal: `store_pass_build` (the
lines from what the keeper typed), `store_pass_match_dispatch` (plan number →
dispatch), `store_pass_unlinked`, `store_pass_log`, `store_pass_notify`,
`store_pass_recon_dispatch_ids`, `store_pass_missing_for_gate_pass`,
`store_pass_notify_discrepancies` (cron). Settings in `store_pass_settings`
(`required_at_gate`), explanations in `store_pass_recon_notes`.

## Roles

| Role | Can |
|---|---|
| `store_pass_officer` (store keeper) | Make, issue and print passes; edit / cancel own drafts. **Cannot link** a pass to a dispatch |
| `store_pass_manager` | Everything above, plus cancel an issued pass (reason), link passes to dispatches and explain discrepancies |
| `dispatch_operator` / `sales_order_manager` | **Link store passes to dispatches** from the Domestic Dispatch page (Store pass column → Link), once per dispatch; gets the notification when a pass is issued unlinked. No store pass pages |
| `store_pass_viewer` | Read only |
| `gate_pass_manager` | Read Dispatch Tracking and the reconciliation; explain discrepancies; link passes to dispatches |
| `gate_security` | Sees the store-pass notice on Gate Check; nothing else new |
| `super_admin` | Everything, plus the gate setting and **correcting a wrong link** (change or remove the dispatch of a linked store pass; change the dispatch of a saved sales gate pass) |

Store pass roles are module tiers (`AuthContext` `MODULE_TIER_DEFINITIONS`):
confined to `/store-pass/*` plus the dashboard shell; they never reach a page
with prices.
