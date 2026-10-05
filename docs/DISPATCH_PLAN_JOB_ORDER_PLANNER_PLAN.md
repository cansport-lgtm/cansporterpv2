# Dispatch Plan & Job Order Planner — plan (proposal, 5 Oct 2026)

Status: **Proposal / planning document** (no code changes yet).

Decisions taken (5 Oct 2026): **domestic only** in phase 1; generated job
orders are created as **Draft** for a manager to issue; job orders are
**grade-wise**; **one lead time** for all departments; the **vehicle master
with capacity is in phase 1**. Still open: how a load becomes a dispatch (DC),
see §11.

## 0. Why

Today the chain from a sales order to a vehicle leaving the gate is:

```
Sales order (confirmed, expected_dispatch_date = deadline)
      → Dispatch DC (office picks orders on the day, no stock check)
      → Store pass SP → Gate pass GP → Out → In Transit
```

and the production side runs beside it, not from it:

```
Job order JO (department + planning items, typed by hand)   Production orders PO (unused link to customer)
Weekly plan (free entry per day/machine)                    Production requirement PR (coordinator)
```

What is missing, found while reading the code (file refs in §9):

- Nothing says **which orders go out on which day**. `expected_dispatch_date`
  is a deadline, not a plan. The dispatch page shows every open domestic order
  and the office decides on the spot.
- Nothing checks **finished-goods stock** before a dispatch is made, and no
  stock is ever reserved for an order.
- **Job orders are not linked to demand.** `job_orders` carry only a department
  and planning items. Nobody can see which sales order a JO serves, or whether
  an order's goods are being made at all.
- Sales orders are in **products + grades, in dozens**; job orders and stock
  closing are in **planning items**. The only bridge is `products.planning_item_id`.

The new module closes the loop:

```
Pending order lines ─▶ DISPATCH PLAN (day · load · lines, soft stock allocation)
                              │ shortage per planning item
                              ▼
                       JOB ORDER PLANNER ─▶ job orders (existing table, now linked to the plan)
                              │ production → daily stock closing
                              ▼
                       plan line released ─▶ Dispatch DC (existing page, pre-filled) ─▶ SP ─▶ GP ─▶ Out
```

It follows the Gate Pass / Store Pass module shape: own number series, tables
read-only to the app, every write through role-checked `dispatch_plan_*`
functions, an event log, rollback script, and this doc kept up to date.

---

## 1. Scope decisions (recommended)

| Decision | Recommendation | Why |
|---|---|---|
| Segment | **Domestic sales orders only** in phase 1 (decided); export behind a setting later | Same choice the Store Pass took; domestic is where the deadline field is mandatory and the multi-order DC exists |
| Job orders | **Extend the existing `job_orders` / `job_order_items`**, do not create a second job-order concept | A "Job Order" already means something to production and the Coordinator page reads it. Two kinds would confuse everyone |
| Unit of planning | Dispatch plan lines in **product + grade, dozens** (what the order says). Shortage and job orders in **planning item + grade** via `products.planning_item_id` (decided: grade-wise) | Keeps the dispatch side identical to the DC; keeps job orders in the vocabulary production already uses, with the grade production actually makes |
| Stock | **Soft allocation only.** The plan reserves nothing in any ledger; availability is computed in a view (closing stock − allocated by other open plans) | The DC already moves stock and books COGS. A second stock movement would break reconciliation |
| Making the DC | **Open — see §11** for the two options and the recommendation | The DC save also posts the AR voucher, COGS and a draft invoice; how the plan reaches that chain decides the build risk |
| Vehicles | **`dispatch_vehicles` master in phase 1** (decided): registration, type, carton capacity, transporter, default driver. A load picks a vehicle; free-text fallback stays for a hired truck | No vehicle master with capacity exists today (`sales_fuel_vehicles` is for fuel claims) |
| Lead time | **One default** for all departments (decided), kept in Settings; skips Sundays and `public_holidays` | Simple to start; a per-department override column can be added later without changing the pages |
| Generated job orders | Created as **Draft** (decided); the planning manager or production issues them from the Job Orders page as today | Keeps a human check before production is told to start |
| Priority | New `priority` on the **plan line**, not on `sales_orders` | Orders have no priority column; adding one touches the heavily used order pages |

---

## 2. What a dispatch plan is

| | |
|---|---|
| Number | `DP-YY-NNNN` (one series, sequence-safe: advisory lock, not `MAX+1` like `JO-`) |
| One plan per | **Dispatch day** (Pakistan date). A week view shows seven plans side by side |
| Made by | Planning officer (`dispatch_plan_officer`) or sales order manager |
| Loads | A plan has 1..n **loads** = one vehicle trip: vehicle (from `dispatch_vehicles`, or free text for a hired truck), driver, transporter, route/city label, sequence. The load shows **cartons loaded / carton capacity** as a fill bar; over capacity is a warning, not a block. Lines can sit on the plan with no load yet ("unassigned") |
| Lines | One line = one `sales_order_items` row × planned dozens (≤ pending). Carries product, grade, packing type, cartons (qty ÷ `packing_types.dozens`), customer, deadline, priority, remarks. A line can be split across days (two lines on two plans for one order item) |
| Availability | Shown per line from `v_fg_availability` (§6): closing stock of the planning item − dozens already planned on other open plans − this line. Red when negative. **Never blocks** saving; it feeds the Job Order Planner |
| Approval | `draft → approved → released → closed`, see flow below |
| Prices | Never stored or shown |

### Flow

```
draft ──approve──▶ approved ──release──▶ released ──(all lines dispatched / day passed)──▶ closed
  │                   │                      │
  └──── cancel ◀──────┘                      └─ lines: planned → dispatched | dropped | carried
```

- **Draft**: officer adds/removes lines and loads, drags lines between days and
  loads, edits quantities. Pending lines come from the picker (§3 Board).
- **Approved**: a manager has signed it off. Lines frozen except manager edits
  (logged). Production roles and the dispatch operator can see it. Notification
  to production roles: "Dispatch plan DP-26-0012 for 7 Oct approved; shortages: 3 items".
- **Released**: the day has come; the dispatch operator opens each load and
  makes its DC — either from the planning module or via the pre-filled
  Domestic Dispatch page, see §11. Saving the DC marks the lines `dispatched`
  (trigger on `sales_dispatch_items`, matched by `order_item_id` and date; §6).
- **Closed**: automatically at the first job run after the day, or by the
  manager. Lines still `planned` are **carried** to the next open plan (one
  click, logged) or **dropped** with a reason. Carried lines keep their origin
  so the tracking page shows "planned 7 Oct, carried to 8 Oct, dispatched 8 Oct".
- A deadline change approved in **Deadline Requests** re-flags any line whose
  plan date is now after the new deadline (badge "after deadline").

### Printout

Per load: "Loading sheet" — plan number, date, vehicle/driver, then grouped by
customer: order number, product, grade, packing, cartons, dozens, remarks, with
a tick column for the store keeper. Same `pdfBuilder` style as the store pass
printout, and the bulk pick-list layout from `dispatchSheetPdf.ts` can be
reused for the per-SKU pick list.

---

## 3. Pages (new sidebar group **Dispatch Planning**, module key `dispatch_planning`, route prefix `/dispatch-planning`)

| Page | Route | What it shows |
|---|---|---|
| Dashboard | `/dispatch-planning/dashboard` | Today's plan status and loads; lines dispatched vs planned (dozens, cartons); orders **overdue** (deadline passed, pending > 0, not planned); orders due in 3 days and unplanned; open shortages count; job orders generated this week and their status |
| Plan Board | `/dispatch-planning/board` | **Week view**: 7 columns (one per plan/day, Sundays and `public_holidays` greyed). Left panel: pending order lines (search, customer, city, deadline, product) sorted by deadline. Drag a line onto a day (native HTML5 drag, same as the Projects Kanban); drop onto a load inside the day to assign the vehicle. Each card: customer · product/grade · dozens · cartons · deadline badge · availability badge. Day footer: totals and shortage count. Buttons: New load, Approve, Release |
| Plan detail | `/dispatch-planning/plans/:id` | One day: loads with lines, availability per line, event history, print loading sheets, approve/release/close, carry/drop lines, vehicle fill bar, **Make dispatch** per load (§11) |
| Plans register | `/dispatch-planning/plans` | List with date range, status, vehicle, customer filters |
| Job Order Planner | `/dispatch-planning/job-order-planner` | The **shortage board** (§4): per planning item, demand in horizon − stock − open job orders = net shortage, with the earliest dispatch date it is needed for and the latest start date. Tick rows → **Generate job orders** |
| Order Fulfilment Tracking | `/dispatch-planning/tracking` | One row per pending order line: deadline → planned date → job order(s) and status → stock → DC → SP → GP → out (stage strip like `/store-pass/tracking`). Filters: stage, customer, overdue, after-deadline |
| Vehicles | `/dispatch-planning/vehicles` (manager) | `dispatch_vehicles` master: registration no, type (own / hired), carton capacity, transporter, default driver and contact, active flag |
| Settings | `/dispatch-planning/settings` (super admin) | Planning horizon (default 14 days), lead time days (one value), segments enabled (domestic now; export later), auto-close plans |

Links added to existing pages (small, additive):

- **Domestic Sales Orders** and **Order Status Board**: a "Planned" column
  (`DP-26-0012 · 7 Oct` or "Not planned") per order / line.
- **Domestic Dispatch**: accepts `?plan_load=<id>` to pre-select orders and
  quantities and shows a banner "From dispatch plan DP-26-0012 / Load 2"
  (option A in §11, or the fallback link under option B).
- **Job Orders** page: a "Source" column (`DP-26-0012 line 4 · SO-…` or
  "Manual") and a filter; items show the sales order they serve.
- **Production Coordinator**: no change needed; it already aggregates
  `Issued`/`Closed` job orders by department, so generated JOs appear there.

---

## 4. Job Order Planner (the shortage board)

Computed in SQL (`dispatch_plan_shortage(p_from, p_to)`), the page only groups:

```
for each (planning item P, grade G) with pending demand in the horizon:
  demand(P,G)        = Σ planned dozens on open plans (draft/approved/released) for products mapped to P with grade G
                       + (toggle) Σ pending dozens of unplanned orders whose deadline is in the horizon
  open_jo(P,G)       = Σ quantity on job_order_items for P and G where JO status in (Draft, Issued)
  stock(P)           = latest daily_stock_closing quantity for P (date shown)      ← per item, no grade
  ball_stock(G)      = Grade Stock Ledger BALL bucket balance for G (loose, unpacked)  ← per grade, no item
  net_shortage(P,G)  = max(0, demand(P,G) − open_jo(P,G) − share(P,G) of stock(P))
  needed_by(P,G)     = earliest plan date (or deadline) among the lines causing the shortage
  start_by(P,G)      = needed_by − lead_time_days, skipping Sundays and public_holidays
```

Row colours: `start_by` already passed → red; within 2 working days → amber.

**Grades (decided: grade-wise).** Sales lines carry `grade_id`, so demand and
job orders are per planning item **and grade**. Finished-goods stock is not:
`daily_stock_closing` is per planning item only, and the Grade Stock Ledger's
BALL bucket is per grade only (loose balls before packing). The board therefore
shows both figures beside each row and apportions the item stock across its
grades **in proportion to demand** for the net-shortage default; the officer
can overtype the quantity before generating. If the business later records
closing stock per grade (a `grade_id` column on `daily_stock_closing` and the
closing page), the apportioning disappears and the figure becomes exact. This
is the one place where the plan is an estimate, and the page says so.

**Generate job orders**: for the ticked rows, one job order **per department**
(`planning_items.department_id`, which must be in `job_order_eligible_departments`)
with `required_by_date = min(needed_by)` of its items, `priority` from the
tightest line, and one `job_order_items` row per **planning item + grade** for
the net shortage (editable before saving). `job_order_items` gets a `grade_id`
column for this; the Job Orders page shows it and the Production Coordinator
can group by it. Each item records its sources (`job_order_item_sources`: plan
line ids and dozens), so the JO can be traced back to sales order lines and the
plan line shows its JO.

Created JOs are **Draft** (decided). The planning manager or production issues
them from the Job Orders page as today. Existing JO behaviour (48 h operator
edit window, print, Closed = read-only) is untouched.

---

## 5. Roles

| Role | Can |
|---|---|
| `dispatch_plan_officer` | Make and edit draft plans, loads and lines; carry/drop lines; run the shortage board; generate job orders (as Draft); print |
| `dispatch_plan_manager` | Everything above, plus approve, release, close, cancel plans; edit approved plans (logged); issue generated job orders; mark overdue reasons |
| `dispatch_plan_viewer` | Read only |
| `sales_order_manager` | Read all pages; make/edit draft plans (they own the orders) |
| `dispatch_operator` | Read released plans and loads; **Make dispatch** from a load |
| `production_manager` / `production_officer` / `production_operator` | Read the Job Order Planner and tracking; no plan edits |
| `super_admin` | Everything, plus Settings |

Roles are added the Store Pass way: enum values in their own migration, then the
module migration; registered in `AuthContext` (role → module, route prefix),
`RolesPage`, `UsersPage` and the sidebar.

---

## 6. Database

New tables (all read-only to clients, writes via functions, RLS select for
authenticated):

- `dispatch_plans` — `plan_number`, `plan_date` (unique per segment), `sales_segment`,
  `status` (`draft|approved|released|closed|cancelled`), `remarks`,
  `approved_by/at`, `released_by/at`, `closed_by/at`, cancel fields,
  `created_by`, timestamps.
- `dispatch_plan_loads` — `plan_id`, `load_no`, `vehicle_number`, `driver_name`,
  `driver_contact`, `transporter_name`, `route_label`, `remarks`,
  `dispatch_id` (set when the DC is made).
- `dispatch_plan_lines` — `plan_id`, `load_id` (nullable), `order_id`,
  `order_item_id`, `product_id`, `grade_id`, `packing_type`, `planned_dozens`,
  `planned_packages`, `priority` (`low|medium|high|critical`), `status`
  (`planned|dispatched|dropped|carried`), `dispatched_dozens`,
  `dispatch_item_id`, `carried_to_line_id`, `drop_reason`, `remarks`.
  Unique on (`plan_id`, `order_item_id`) so a line is split across days, never
  duplicated within one.
- `dispatch_plan_events` — every state change with details (mirror of
  `store_pass_events`).
- `job_order_item_sources` — `job_order_item_id`, `dispatch_plan_line_id`,
  `sales_order_item_id`, `dozens`. This is the demand → job order link.
- `dispatch_plan_settings` — single row: `horizon_days`, `lead_time_days`,
  `segments` (text[], `{domestic}` to start), `auto_close`.
- `dispatch_vehicles` (phase 1, decided) — `registration_no` (unique),
  `vehicle_type` (`own|hired`), `carton_capacity`, `transporter_name`,
  `default_driver_name`, `default_driver_contact`, `is_active`, `remarks`.
  `dispatch_plan_loads.vehicle_id` references it (nullable; free text stays
  for a one-off hired truck).

Changes to existing tables (additive, nullable):

- `job_orders`: `source` (`manual|planner`, default `manual`),
  `dispatch_plan_id` (the plan that generated it, if one).
- `job_order_items`: `grade_id` (→ `grades`; required for planner-generated
  items, optional for manual ones), `product_id` (informational).

Views / functions:

- `v_dispatch_pending_lines` — one row per open domestic order item:
  pending dozens (`quantity_dozens − quantity_dispatched`), deadline,
  customer/city, already-planned dozens on open plans, unplanned remainder,
  overdue flag. Drives the picker, the dashboard counts and the order-page
  column. Replaces the client-side arithmetic now repeated in three pages.
- `v_fg_availability` — per planning item: latest `daily_stock_closing`
  quantity and date, allocated dozens on open plans, open job order quantity,
  free quantity.
- `v_dispatch_plan_tracking` — one row per order line with plan / JO / DC / SP /
  GP / out stages and timestamps (joins `v_store_gate_tracking`).
- `dispatch_plan_shortage(p_from date, p_to date, p_include_unplanned boolean)` — §4.
- `dispatch_plan_save(p_id, p_data)`, `dispatch_plan_line_move(p_line_id, p_plan_id, p_load_id)`,
  `dispatch_plan_approve`, `dispatch_plan_release`, `dispatch_plan_close`,
  `dispatch_plan_cancel`, `dispatch_plan_line_carry`, `dispatch_plan_line_drop`,
  `dispatch_plan_generate_job_orders(p_rows jsonb)`, `dispatch_plan_settings_save`,
  `dispatch_plan_daily_close` (cron, Pakistan midnight + grace).
- Trigger on `sales_dispatch_items` insert/update/delete: find the `planned`
  line for the same `order_item_id` on a released plan for the dispatch date
  (or the load whose `dispatch_id` is set), update `dispatched_dozens`,
  `dispatch_item_id`, status. Deletion of a DC item reverts the line.
- Trigger on `deadline_change_requests` approval: flag lines now after deadline
  (event + notification to the plan's creator).
- `generate_job_order_number` should move to an advisory-locked or sequence
  based numbering at the same time (today `MAX+1` can collide when the planner
  creates several JOs in one transaction).

Rollback: `supabase/rollbacks/<ts>_dispatch_planning_down.sql` (drops the new
objects, removes the added columns, keeps nothing).

---

## 7. Notifications (via the existing `notify_role` / `notify_user` functions)

| Event | To |
|---|---|
| Plan approved | `production_manager`, `production_officer`, `dispatch_operator` |
| Plan released | `dispatch_operator`, `store_pass_officer` |
| Job orders generated / issued from the planner | Department supervisors (`production_*`) |
| Daily 08:00 PKT | `dispatch_plan_manager`, `sales_order_manager`: overdue unplanned orders, today's shortages whose start date has passed |
| Deadline approved that breaks a plan | Plan creator |

---

## 8. Phasing and estimate

| Phase | Delivers | Size |
|---|---|---|
| **1 — Dispatch Plan** | Roles, tables, views, functions; Vehicles master with carton capacity and load-fill bar; Plan Board (week, drag, loads), Plan detail, register, Dashboard; availability badges; load → DC per the §11 decision; dispatch-item trigger; "Planned" column on order pages; loading-sheet print; doc | ~4 days (option A) / ~5 days (option B) |
| **2 — Job Order Planner** | Shortage function and board (item + grade); generate Draft job orders with sources and `grade_id`; lead time setting; JO page "Source" and grade columns; Fulfilment Tracking page; notifications; JO numbering fix | ~2–3 days |
| **3 — Extras** | Export segment; grade-wise stock closing if wanted (makes the shortage exact); carton weight/CBM if the business wants weight planning; one-click DC if option A was chosen in phase 1 | ~2 days |

Each phase ships on its own, with its own migration + rollback, and is usable
without the next.

---

## 9. What this builds on (file references)

- Sales orders: `sales_orders.expected_dispatch_date` is mandatory on domestic
  orders (`src/components/sales/DomesticSalesOrdersPage.tsx:566`); statuses are
  `draft, confirmed, in_production, ready, partially_dispatched, dispatched,
  delivered, cancelled` (migration `20260112200932`); `quantity_dispatched` is
  trigger-maintained from `sales_dispatch_items`.
- Pending is computed client-side as `quantity_dozens − quantity_dispatched` in
  `DomesticDispatchPage.tsx:210`, `DomesticOrderStatusPage.tsx:96`; the Pending
  Dispatch page lists only orders with **no** dispatch (`DomesticPendingDispatchPage.tsx:65`).
- Dispatch save chain: `DomesticDispatchPage.tsx:216-326` → `postDispatchVoucher`,
  `postCOGSForDispatch`, `createInvoiceForDispatch`.
- Job orders: `job_orders` (`JO-YY-NNNN`, `Draft/Issued/Closed`, `department_id`,
  `required_by_date`) and `job_order_items` (`planning_item_id`, `quantity`);
  UI `src/pages/planning/JobOrdersPage.tsx`; eligibility list
  `job_order_eligible_departments`; consumer `ProductionCoordinatorPage.tsx:162-270`.
- Stock: `daily_stock_closing` per `planning_item_id`; `products.planning_item_id`
  (migration `20260801160000`).
- Capacity: `capacity_master` (`capacity_per_hour`, `capacity_per_day`), only
  used client-side in `WeeklyPlanningPage.tsx:212-222`.
- Working days: Sundays and `public_holidays`, as in the Production Coordinator.
- Store pass chain and tracking view: `v_store_gate_tracking`
  (migration `20261008120100`), `src/pages/store-pass/DispatchTrackingPage.tsx`.
- Drag and drop: native HTML5, `src/pages/projects/ProjectKanbanPage.tsx:178-239`.
- Module pattern to copy: `docs/STORE_PASS_PLAN.md`, migrations
  `20261008120000_store_pass_roles.sql`, `20261008120100_store_pass.sql`.

---

## 10. Decisions and remaining questions

Decided on 5 Oct 2026:

| Question | Decision |
|---|---|
| Segment | Domestic only in phase 1 |
| Generated job orders | Created as Draft; a manager issues them |
| Grades | Job orders are grade-wise (planning item + grade); stock apportioned as in §4 until closing stock is recorded per grade |
| Lead time | One value for all departments (Settings) |
| Vehicle master | In phase 1, with carton capacity |

Still open:

1. **How a load becomes a DC** — §11, needs a choice between option A and B.
2. **Unplanned demand in the shortage**: include unplanned orders due within
   the horizon by default (recommended, as a toggle on the board), or only
   what is on a plan?
3. **Capacity**: should the Job Order Planner also check `capacity_master`
   hours per department against the generated quantities (warning only)?
   Recommended for phase 2 as a warning column; it costs little once the
   shortage function exists.
4. **Who maintains the vehicle master**: planning manager (recommended) or
   super admin only?

---

## 11. How a released load becomes a dispatch (DC)

### What "making a DC" does today

Saving a dispatch on the Domestic Dispatch page (`DomesticDispatchPage.tsx:216-330`,
validations at `:560-598`) is not just an insert. In order:

1. **Validations**: at least one order and one quantity; every selected
   customer has a **Billing Customer** (otherwise the sale would never reach
   Accounts Receivable); no line with a **zero price** (otherwise COGS posts
   with no revenue).
2. **Inserts**: `sales_dispatches` header (vehicle, driver, transporter,
   delivery address, expected delivery date, `sales_segment = domestic`),
   `sales_dispatch_orders` (one per order), `sales_dispatch_items` (one per
   line). Database triggers then update `sales_order_items.quantity_dispatched`
   and the order status (`partially_dispatched` / `dispatched`).
3. **Post-save chain**, non-blocking, each with its own warnings:
   `postDispatchVoucher` (Dr AR / Cr Sales, per billing customer),
   `postCOGSForDispatch` (Dr COGS / Cr FG, skipped in periodic mode or for
   zero-cost products), `createInvoiceForDispatch` (one draft invoice per
   customer). Dispatch quantities are **locked** once invoiced or posted.

So whatever makes the DC from a plan must either run this exact code or send
the user to it. There are two honest ways to do that.

### Option A — hand-off: the load pre-fills the existing Dispatch page

```
Plan detail → Load 2 → [Make dispatch] → /domestic/dispatch?plan_load=<id>
   → New Dispatch dialog opens with: orders ticked, lines = planned dozens and
     packing, vehicle / driver / transporter from the load, date = plan date
   → operator reviews, may edit, presses Save → today's save path runs unchanged
   → trigger marks the plan lines dispatched; the load records the DC number
```

| | |
|---|---|
| Code touched | Dispatch page: read one query parameter, pre-select orders and quantities, show a banner "From plan DP-26-0012 · Load 2", pass the load id to a small RPC after save (`dispatch_plan_load_attach(p_load_id, p_dispatch_id)`). The save, validations and posting chain are **not touched** |
| Operator experience | Two screens. The operator lands on the page they already use, everything filled in; they only check and save |
| Plan discipline | Soft. The operator can change quantities or untick an order. Tracking shows **planned ≠ dispatched** per line and the deviation is logged, but nothing stops it |
| Edge cases | Pending quantity changed since planning (order edited): the dialog clamps to pending and warns. Order cancelled: line shown struck out, dropped on save. Several customers in one load: supported (multi-order DC, invoice per customer) |
| Risk | Low. No change to money-posting code; regression limited to the dialog's opening state |
| Build | ~½ day inside phase 1 |
| Downsides | The planner is not self-contained; the office must still use the Dispatch page; phone use is poor because that page is desktop-sized |

### Option B — one click: the load creates the DC from the planning module

```
Plan detail → Load 2 → [Create dispatch] → review dialog
   (lines with planned dozens, pending now, availability, vehicle / driver,
    delivery address, expected delivery date; quantities editable, edits logged)
   → [Confirm] → createDomesticDispatch(...) → DC + AR voucher + COGS + draft invoice
   → load.dispatch_id set, lines dispatched, remainder (if any) offered as "carry"
```

| | |
|---|---|
| Code touched | **First** extract the save, validations and post-save chain out of `DomesticDispatchPage.tsx` into `src/lib/sales/createDomesticDispatch.ts` (input: header fields, order ids, lines; output: dispatch + the list of warnings the page shows as toasts today). The Dispatch page is switched to call it, with no behaviour change. **Then** the planning module calls the same function from the review dialog. One implementation, two callers |
| Operator experience | One screen; never leaves the plan. Works on a phone |
| Plan discipline | Strong. Quantities come from the plan; any change in the review dialog is an event on the plan ("Load 2: SO-1041 line 2 reduced 120 → 96 dz by …"). Vehicle actually used can differ from planned, also logged |
| Edge cases | Same as A, handled in the review dialog before confirm: clamp to pending, drop cancelled, warn on negative availability (block only if a manager turns on `block_on_negative_stock` in Settings), warn when cartons exceed the vehicle capacity |
| Risk | Medium. The extraction touches the most sensitive path in the sales module (AR, COGS, invoices). It is a pure move of code, but it needs a full manual test of the Dispatch page afterwards (normal DC, multi-customer DC, periodic-COGS mode, missing billing customer, zero price) before anything else is built on it |
| Build | ~1½ days inside phase 1 (≈ 1 day extraction + test, ½ day dialog) |
| Downsides | More to test up front; the Dispatch page still exists for ad hoc dispatches outside a plan, so there are two entry points to the same function (by design) |

### What is common to both

- The link between plan line and DC item is made by the **trigger on
  `sales_dispatch_items`** (§6), matched on `order_item_id` within a released
  plan on that date. This works for both options and also catches a DC made by
  hand for a planned order, so tracking never loses a line.
- Partial dispatch of a load (truck full, stock short) leaves the remaining
  dozens as `planned`; closing the day carries or drops them, as in §2.
- Neither option changes gate pass, store pass, invoicing or accounting
  behaviour.

### Recommendation

**Option B, built as two steps inside phase 1**, with option A's pre-fill kept
as a fallback link on the load ("Open in Dispatch page") for the cases the
office prefers the old screen. Reasons: the plan is only as good as its
enforcement, and B is the only option where "dispatched" means "as planned
unless someone deliberately changed it and the change is logged". The extra
cost is about one day, almost all of it the test pass on the Dispatch page,
and that extraction pays for itself later (export, direct DC from store pass,
mobile dispatch) because the posting chain stops living inside one React
component.

If the business would rather not touch the Dispatch page's save path right
now, **option A ships in phase 1** and B moves to phase 3 with no rework: the
trigger, the load record and the review of planned vs dispatched are the same
in both.
