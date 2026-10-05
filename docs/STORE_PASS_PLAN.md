# Store Pass — plan (approved 3 Oct 2026)

Decisions taken: no approval step; gate behaviour `warn` first,
`block` via the setting; **domestic sales dispatches only** for now; the daily
20:30 discrepancy notification is included. Mock: the "Store Pass Mock" canvas.

**Changed after go-live (5 Oct 2026):** the store keeper does not know the
vehicle or driver and does not pick system dispatches. The pass is now a
free-text **dispatch plan no.**, free-text **items**, the **hand-over person**
and a **photo of the stock at the loading dock**. Linking to system dispatches
is optional (automatic when the plan number is a DC number, else by the
office) and remains the basis of tracking and reconciliation. See
`docs/STORE_PASS.md` for what is live; the sections below describe the
original design.

A **store pass** records finished goods physically handed over by the
finished-goods store for dispatch, *before* the vehicle reaches the gate. Today
the chain is:

```
Sales order (approved) → Dispatch DC-xxxxx (office) → Gate pass GP-xxxxxx (sales type, one vehicle) → guard counts → Out → In Transit
```

Nothing records what the store actually released. The store pass fills that
gap, and the **Daily Reconciliation** page compares, day by day, what the
office dispatched, what the store issued and what left the gate.

```
Sales order → Dispatch DC → Store pass SP (store keeper issues) → Gate pass GP → Gate out → In Transit
                                   ↓                                   ↓
                              Daily store ↔ gate reconciliation (discrepancies)
```

The module follows the Gate Pass module exactly: its own number series, tables
read-only to the app, every write through role-checked `store_pass_*` database
functions, an event log per pass, rollback script, and a doc in `docs/`.

---

## 1. What a store pass is

| | |
|---|---|
| Number | `SP-000001`, `SP-000002`, … (one series, given only on a successful save) |
| Made by | The store keeper (`store_pass_officer`), on desk or phone |
| Against | **One vehicle**, carrying one or more pending **domestic** dispatches (DC) of approved sales orders (`sales_dispatches`, `sales_segment = domestic`), exactly like the sales gate pass. A dispatch can be on only one live store pass; cancelled passes free it again |
| Lines | Copied from the dispatch items, grouped by dispatch: product, packing type, dozens, cartons. The store keeper confirms or corrects the **issued** figures; the dispatch figures are kept beside them as a snapshot |
| Also records | Vehicle number, driver name / contact, issue date/time, store keeper, who received the goods (loader / driver), loading bay / store location (optional), remarks, optional photo of the loaded stack |
| Approval | None. It is the store keeper's time-stamped record, like a gate guard's count |
| Stock | **None.** The dispatch already moves finished goods (WIP ledger FG level, COGS). The store pass is a control document only |
| Prices | Never stored or shown |

### Flow

```
draft → issued → (cancelled)
```

- **Draft**: store keeper can edit lines, add or remove dispatches, refresh from the dispatches, cancel.
- **Issued**: goods have left the store. Lines are frozen. Only a store pass
  manager (or super admin) can cancel it, with a reason; the store keeper then
  makes a new one. The original stays in the pass history.
- Issuing short of the dispatch is allowed but **needs a remark** on the line;
  the difference shows on the pass and in the reconciliation. Issuing *more*
  than the dispatch is not allowed (same rule as the gate: correct the DC
  first).
- If the office edits the dispatch after the pass is issued, the tracking and
  reconciliation pages flag **"dispatch changed after issue"** (snapshot ≠
  current).

### Printout

Same style as the gate pass printout: QR of the SP number, DC number, customer,
lines (product · packing · cartons · dozens), issued by / received by,
signatures. Printed from the detail page and from the list.

---

## 2. Links to the Gate Pass module (small, additive)

- **New Gate Pass (Sales)** form: each dispatch in the picker shows its store
  pass badge — `SP-000123 · Issued 14:05` or **No store pass**.
- **Gate Check**: when a sales pass is opened and one of its dispatches has no
  issued store pass, the guard sees a notice. Behaviour is a super-admin
  setting, `store_pass_required_at_gate`:
  - `off` — nothing shown
  - `warn` (**default**) — yellow notice; the pass can still go out; the event
    `no_store_pass` is logged on the gate pass and the store managers are
    notified
  - `block` — the vehicle cannot go out until a store pass is issued
- **Dispatch list / dispatch dashboard**: one extra column, **Store pass**
  (next to the existing Gate pass / Gate out columns).
- Nothing in gate counting, release, dispatch, invoicing or COGS changes.

---

## 3. Pages (new sidebar group **Store Pass**, module key `store_pass`)

| Page | Route | What it shows |
|---|---|---|
| Dashboard | `/store-pass/dashboard` | Today: dispatches made, store passes issued, gone out; issued-but-not-out (with hours waiting); open discrepancies (7 days); recent passes |
| Store Passes | `/store-pass/passes` | Register with search, date range, status and segment filters; print |
| New Store Pass | `/store-pass/new` | Vehicle and driver → tick the pending domestic dispatches going on it (no live store pass, not delivered; today's first) → lines auto-filled per dispatch → confirm issued cartons / dozens → receiver, bay, remarks, photo → **Issue** (or save draft) |
| Store Pass detail | `/store-pass/passes/:id` | Pass, lines with dispatch vs issued, linked gate pass and its gate status, event history, print, cancel |
| Dispatch Tracking | `/store-pass/tracking` | One row per dispatch: DC → SP → GP → Out → Delivered as a stage strip, with hours between stages. Filters: stage (no store pass / issued, no gate pass / on gate pass, waiting / held / out / delivered), segment, customer, date range. Links to DC, SP, GP |
| Daily Reconciliation | `/store-pass/reconciliation` | See §4 |

The Gate Pass group gets one extra link, **Store ↔ Gate Reconciliation**, to
the same reconciliation page, for gate pass managers.

---

## 4. Daily Reconciliation

Pick a day (Pakistan time; a range is also allowed). Three sources are lined up
per dispatch (a store pass covers a vehicle, but every line belongs to one
dispatch item, so the comparison stays one-to-one per dispatch):

| Source | Date used | Figures |
|---|---|---|
| Dispatch (DC) | `dispatch_date` | dozens, cartons per line |
| Store pass (SP) | `issued_at` | issued dozens, cartons per line |
| Gate pass (GP) | `gate_out_at` | printed and **counted** cartons / dozens per line |

**Summary cards**: dispatches · store passes issued · gate outs (count, dozens,
cartons each) and the discrepancy count by type.

**Discrepancy types** (each row can carry several):

| Code | Meaning | Severity |
|---|---|---|
| `OUT_NO_SP` | Went out of the gate with no issued store pass | High |
| `SP_NOT_OUT` | Issued by the store but not out by day end | High (goods are somewhere between store and gate) |
| `SP_VS_GP` | Store issued ≠ counted at the gate (cartons or dozens) | High |
| `SP_VS_DC` | Store issued ≠ dispatch figures | Medium |
| `DC_CHANGED` | Dispatch edited after the store pass was issued | Medium |
| `SP_CANCELLED_AFTER_ISSUE` | An issued pass was cancelled (reason shown) | Info |
| `CROSS_DAY` | Issued on one day, out on another (shown on both days) | Info |
| `DC_PENDING` | Dispatch made, no store pass and no gate pass yet | Info |

**Product view** (tab): per SKU for the day — dispatched, store issued, gate
counted, difference. This is what the store keeper uses to check the FG store.

**Resolution**: a manager can mark a discrepancy **Explained** with a note
(stored in `store_pass_recon_notes`, keyed by dispatch + type + day). Open ones
stay red on the dashboard until explained or until the figures match.

**Export / print**: CSV and a print view of the day.

**Daily notice** (optional, like the gate pass overdue notice): at 20:30
Pakistan time, store pass managers and gate pass managers get one notification
with the day's open high-severity discrepancies.

---

## 5. Roles

| Role | Can |
|---|---|
| `store_pass_officer` (store keeper) | Make, issue and print passes; edit / cancel own drafts; see all pages read-only |
| `store_pass_manager` | Everything above, plus cancel an issued pass (reason), mark discrepancies explained |
| `store_pass_viewer` | Read only |
| `gate_pass_manager` | Read tracking and reconciliation; mark discrepancies explained |
| `gate_security` | Nothing new; sees the store-pass notice on Gate Check |
| `super_admin` | Everything, plus the `store_pass_required_at_gate` setting |

Roles are added the same way as the gate pass roles (enum values in their own
migration, then the module migration), and registered in `AuthContext`
(role → module), `RolesPage`, `UsersPage` and the sidebar.

---

## 6. Database

New (all read-only to clients, writes via functions):

- `store_passes` — pass header: `pass_number`, `status`, `pass_date`,
  `vehicle_number`, `driver_name`, `driver_contact`, `party_name` (customers),
  `issued_at`, `issued_by`, `received_by_name`, `store_location`, `photo_url`,
  `remarks`, cancel fields, `created_by`, timestamps.
- `store_pass_dispatches` — which dispatches travel on the pass (one vehicle,
  many dispatches), mirroring `gate_pass_dispatches`. A dispatch can be on
  only one live pass (checked in the build function).
- `store_pass_items` — `line_no`, `product_id`, `dispatch_id`, `dispatch_item_id`,
  `description`, `packing_type`, `uom`, `dispatch_quantity`,
  `dispatch_packages` (snapshot), `quantity` (issued), `packages` (issued),
  `lot_no`, `remarks`.
- `store_pass_events` — every state change, with details.
- `store_pass_recon_notes` — `dispatch_id`, `discrepancy_code`, `recon_date`,
  `note`, `resolved_by`, `resolved_at`.
- `store_pass_settings` — single row: `required_at_gate` (`off|warn|block`).

Views / functions:

- `v_dispatch_store_pass` — live store pass per dispatch (for the dispatch
  columns and the gate pass form), mirroring `v_dispatch_gate_pass`.
- `v_store_gate_tracking` — one row per dispatch with DC / SP / GP / out /
  delivery figures and timestamps (drives Tracking and Reconciliation).
- `store_pass_reconcile(p_from date, p_to date)` — returns the per-dispatch
  rows with the discrepancy codes computed in SQL, so the page only groups.
- `store_pass_save(p_id, p_data, p_issue)`, `store_pass_issue`,
  `store_pass_cancel`, `store_pass_refresh` (draft only),
  `store_pass_recon_resolve`, `store_pass_settings_save`,
  `store_pass_notify_discrepancies` (cron).
- One small change in `gate_pass_gate_check`: the store-pass check described in
  §2, reading the setting (default `warn`, so nothing blocks on day one).

Rollback: `supabase/rollbacks/<ts>_store_pass_down.sql`.

---

## 7. Frontend files

- `src/lib/storePass.ts` — types, status meta, discrepancy meta, `spDb`,
  query hooks, print HTML (pattern of `src/lib/gatePass.ts`).
- `src/pages/store-pass/` — `StorePassDashboardPage`, `StorePassListPage`,
  `StorePassFormPage`, `StorePassDetailPage`, `DispatchTrackingPage`,
  `StoreGateReconciliationPage`.
- `src/components/store-pass/` — `StorePassLinesEditor`, `StageStrip`,
  `DiscrepancyBadge`, `DispatchStorePass` (the list-column badge, like
  `DispatchGatePass`).
- Edits: `App.tsx` routes, `ERPSidebar.tsx` group, `AuthContext.tsx` role map,
  `RolesPage.tsx`, `UsersPage.tsx`, `DispatchPageBase.tsx` and the dispatch
  dashboard (Store pass column), `GatePassFormPage.tsx` (badge in the dispatch
  picker), `GateCheckPage.tsx` (notice), `docs/STORE_PASS.md`.

---

## 8. Delivery in two steps

| Step | Contents | Result |
|---|---|---|
| **1 — Store pass** | Roles, tables, functions, Store Passes list / new / detail / print, Dispatch Tracking page, Store pass column on dispatch pages, badge on the gate pass form, sidebar, docs | Store keeper starts issuing passes; tracking shows the chain |
| **2 — Reconciliation** | Daily Reconciliation page with product view, discrepancy notes, dashboard, Gate Check notice with the `off / warn / block` setting, daily notification | Discrepancies visible and explainable; gate can be made to require a store pass |

Both steps go on the branch `claude/gracious-mendel-xqjmol`, one PR each, with
the SQL applied by the usual migration path.

---

## 9. Decisions (confirmed)

1. **One store pass per vehicle**, covering several dispatches, like the
   sales gate pass. Lines stay per dispatch item, so reconciliation is still
   per dispatch.
2. **No approval step** on the store pass; tracking only.
3. **Gate behaviour without a store pass: warn** first, `block` later via the
   super-admin setting.
4. **Short issue allowed with a remark; over-issue blocked.**
5. **Scope: domestic sales dispatches only** (Sales module, `sales_segment =
   domestic`). Export, private label, distributor dispatches and samples can
   be added later.
6. **Daily discrepancy notification at 20:30 Pakistan time** to store pass
   managers and gate pass managers.
