# Dispatch Plan & Job Order Planner — plan (proposal, 5 Oct 2026)

Status: **Proposal / planning document** (no code changes yet).

Decisions taken (5 Oct 2026): the module is a **planner only**. It **reads**
data from the other modules and **suggests** a dispatch plan and job orders.
It does not create dispatches, job orders, stock movements or vouchers, adds
no triggers or columns to any other module's tables, and changes no existing
page. Domestic sales only in phase 1; suggestions are grade-wise; one lead
time for all departments; a planner-owned vehicle master with carton capacity
in phase 1.

## 0. Why, and the boundary

Today the chain from a sales order to a vehicle leaving the gate is:

```
Sales order (confirmed, expected_dispatch_date = deadline)
      → Dispatch DC (office picks orders on the day, no stock check)
      → Store pass SP → Gate pass GP → Out → In Transit
```

and the production side runs beside it:

```
Job order JO (department + planning items, typed by hand)   Weekly plan   Production requirement PR (coordinator)
```

What is missing, found while reading the code (file refs in §9):

- Nothing says **which orders should go out on which day**. `expected_dispatch_date`
  is a deadline, not a plan.
- Nothing shows **finished-goods stock against pending orders**, so nobody
  sees in advance which orders cannot be dispatched.
- **Job orders are not derived from demand.** Production decides what to make
  from experience; no page says "to meet the orders due next week you must
  start these items by Thursday".
- Sales orders are in **products + grades, in dozens**; job orders and stock
  closing are in **planning items**. The only bridge is `products.planning_item_id`.

The planner answers those three questions on screen and on paper. The office
still makes the DC on the Domestic Dispatch page, and production still types
the job orders on the Job Orders page, using the planner's printout.

```
                 ┌─────────────────── READS ONLY ────────────────────┐
sales_orders / items · sales_dispatches / items · daily_stock_closing · grade ledger
job_orders / items · capacity_master · public_holidays · products · planning_items · customers
                 └───────────────────────┬───────────────────────────┘
                                         ▼
                        DISPATCH PLANNER (own tables only)
          suggested dispatch days & loads · shortage · suggested job orders · plan vs actual
                                         │ printouts / CSV
                                         ▼
      office makes DCs (existing page)          production makes JOs (existing page)
```

**The boundary, stated once:**

| The planner does | The planner never does |
|---|---|
| Reads the tables above through read-only views | Inserts, updates or deletes rows in any table outside `dispatch_planner_*` |
| Computes suggestions in SQL functions that write nothing | Creates a `sales_dispatches`, `job_orders`, `stock_movements` or voucher row |
| Saves its own plan snapshots, vehicles and settings in `dispatch_planner_*` tables | Adds a trigger, column, view dependency or RLS change on another module's tables |
| Prints and exports | Changes any existing page, route or role's behaviour |
| Compares its saved suggestion with what actually happened (read) | Blocks, warns or pre-fills anything in Dispatch, Job Orders, Store Pass or Gate Pass |

Because of this boundary the module can be installed and removed with one
migration and one rollback and nothing else in the system notices.

---

## 1. What the planner produces

### A. Suggested dispatch plan

For a horizon (default today + 14 days) the planner takes every pending
domestic order line and proposes **a dispatch day and a load** for it.

Inputs per line (all read): pending dozens (`quantity_dozens − quantity_dispatched`),
deadline (`expected_dispatch_date`), order date, customer, city, product,
grade, packing type (cartons = dozens ÷ `packing_types.dozens`), the product's
planning item, finished-goods stock of that planning item, and open job orders
for it.

Rules (deterministic, shown next to every suggestion so the planner can be
trusted and argued with):

1. Lines are ordered by **deadline**, then **order date** (oldest first). An
   officer can pin a line to a day or mark it urgent; pins are stored in the
   planner's own tables and respected on the next run.
2. Stock is **allocated on paper** in that order: a line gets stock while the
   planning item has any left (for grade-wise items see §3). A line that gets
   its full quantity is **dispatchable**; one that gets part is **partial**;
   one that gets none is **needs production**.
3. A dispatchable line is suggested for the **earliest working day** not
   before today and not after the deadline, filling days in deadline order.
   Sundays and `public_holidays` are skipped. If the deadline is already past,
   it is suggested for today and flagged **overdue**.
4. Within a day, lines are grouped into **loads** by city (then customer) up
   to the vehicle's **carton capacity** from the planner's vehicle master; a
   day with more cartons than the active fleet is flagged **over fleet
   capacity**, and the overflow moves to the next working day.
5. A needs-production line is suggested for `start_by + lead_time_days`
   (working days), where `start_by` is today or later. If that lands after the
   deadline the line is flagged **will be late by N days**.

The result is a **week board**: days as columns, loads as groups, lines as
cards with their badges (dispatchable / partial / needs production / overdue /
will be late / pinned). The officer can drag a line to another day or load;
the planner re-checks stock and capacity and shows the effect. "Re-suggest"
recomputes from scratch, keeping pins.

### B. Shortage and suggested job orders

For the same horizon, per **planning item + grade**:

```
demand(P,G)        = Σ pending dozens of lines due in the horizon for products mapped to P with grade G
open_jo(P,G)       = Σ quantity on Draft/Issued job_order_items for P  (grade: see §3)
stock(P)           = latest daily_stock_closing quantity for P (with its date)
ball_stock(G)      = Grade Stock Ledger BALL balance for G (loose balls before packing)
net_shortage(P,G)  = max(0, demand − open_jo − share of stock(P) apportioned to G by demand)
needed_by(P,G)     = earliest suggested dispatch day among the lines short of stock
start_by(P,G)      = needed_by − lead_time_days (working days)
```

The **Suggested Job Orders** view groups the shortage rows by **department**
(`planning_items.department_id`, limited to `job_order_eligible_departments`)
exactly in the shape of the Job Orders form: department, required-by date,
priority, then items with planning item, grade, quantity, and a "for" column
listing the sales orders served. Rows whose `start_by` has passed are red;
within two working days, amber. The page prints as one sheet per department,
and production types the job order from it. **The planner does not create the
job order.**

Optional (phase 2, warning only): hours needed per department
(`quantity ÷ capacity_master.capacity_per_hour`) against
`working_hours_per_day × working days until needed_by`.

### C. Plan vs actual

A suggestion can be **saved as a plan version** (planner tables only). The
Plan vs Actual page later joins it, read-only, to what happened:

- per line: suggested day → actual `sales_dispatches.dispatch_date` (matched on
  `order_item_id`), dispatched dozens, days early/late, still pending;
- per suggested job order item: whether a job order for that planning item
  (and grade, when the JO carries one) was created within the window, its
  status, and the quantity;
- summary: % of lines dispatched on the suggested day, % within deadline,
  shortages that were covered vs not.

This is how the business learns whether the suggestions are worth following,
without the planner ever touching the operational data.

---

## 2. Pages (new sidebar group **Dispatch Planner**, module key `dispatch_planner`, route prefix `/dispatch-planner`)

| Page | Route | What it shows |
|---|---|---|
| Dashboard | `/dispatch-planner/dashboard` | Pending orders: count, dozens, cartons; overdue (deadline passed, pending > 0); due in 3 / 7 days; dispatchable vs needs-production split; shortage count by department; fleet cartons/day vs suggested; last saved plan and its plan-vs-actual score |
| Suggested Dispatch Plan | `/dispatch-planner/board` | The week board of §1A. Horizon picker, Re-suggest, pin/unpin, urgent flag, drag between days and loads, per-day totals and fleet fill, Save as version, print loading suggestions |
| Pending Lines | `/dispatch-planner/pending` | Flat table of every pending line with pending, deadline, stock, suggested day, badges; filters and CSV. The "working list" for the sales order manager |
| Shortage & Suggested Job Orders | `/dispatch-planner/job-orders` | §1B. Tabs: by planning item + grade; by department (printable job-order sheets); include unplanned lines toggle |
| Plan vs Actual | `/dispatch-planner/versions` | Saved versions; open one to see §1C |
| Vehicles | `/dispatch-planner/vehicles` | Planner-owned fleet master: registration, type (own / hired), carton capacity, active |
| Settings | `/dispatch-planner/settings` (super admin) | Horizon days, lead time days, working-day rules (Sunday off, use `public_holidays`), stock source date tolerance (how old a closing may be before it is flagged stale), segments (domestic now) |

No link, column, banner or button is added to any existing page.

---

## 3. Grades

Sales lines carry `grade_id`, so demand and suggested job orders are per
planning item **and grade** (decided). Stock is not: `daily_stock_closing` is
per planning item only, and the Grade Stock Ledger's BALL bucket is per grade
only. The planner therefore:

- allocates the planning item's stock across its grades **in proportion to
  demand** and marks the figure "apportioned";
- shows the BALL balance per grade beside it as a second signal;
- matches open job orders to a grade only when `job_order_items.grade_id`
  exists (it does not today), otherwise at planning-item level, and says so.

If the business later records closing stock per grade, or adds a grade to job
order items, the planner's views pick it up and the "apportioned" label
disappears. Those would be changes in their own modules, decided separately;
this plan does not make them.

---

## 4. Roles

| Role | Can |
|---|---|
| `dispatch_planner_officer` | Run suggestions, pin / drag / flag, save versions, print, export |
| `dispatch_planner_manager` | Everything above, plus vehicles master, delete a version |
| `dispatch_planner_viewer` | Read only |
| `sales_order_manager`, `dispatch_operator` | Read all planner pages (module access added in `AuthContext`, nothing else changes for them) |
| `production_manager` / `production_officer` / `production_operator` | Read Shortage & Suggested Job Orders and Plan vs Actual |
| `super_admin` | Everything, plus Settings |

Roles are added the Store Pass way: enum values in their own migration, then
the module migration; registered in `AuthContext` (role → module, route
prefix), `RolesPage`, `UsersPage` and the sidebar.

---

## 5. Database

**Planner-owned tables** (prefix `dispatch_planner_`; read for authenticated,
writes only through role-checked functions):

- `dispatch_planner_versions` — saved suggestion: `version_number` (`DPV-YY-NNNN`),
  `horizon_from`, `horizon_to`, `params` (jsonb: lead time, settings used),
  `label`, `created_by`, `created_at`.
- `dispatch_planner_version_loads` — `version_id`, `plan_date`, `load_no`,
  `vehicle_id`, `city_label`, `cartons`.
- `dispatch_planner_version_lines` — `version_id`, `load_id`, `plan_date`,
  `order_id`, `order_item_id`, `product_id`, `grade_id`, `planning_item_id`,
  `suggested_dozens`, `cartons`, `status_at_save` (dispatchable / partial /
  needs_production), `flags` (text[]), `pinned`, `urgent`, `reason` (the rule
  that placed it).
- `dispatch_planner_version_shortages` — `version_id`, `planning_item_id`,
  `grade_id`, `department_id`, `demand`, `stock_apportioned`, `open_jo`,
  `net_shortage`, `needed_by`, `start_by`.
- `dispatch_planner_pins` — live officer adjustments between runs:
  `order_item_id`, `pinned_date`, `urgent`, `note`, `created_by`. (References
  an order item by id only; no FK that could block the sales module from
  deleting, and a cleanup function removes pins for lines no longer pending.)
- `dispatch_planner_vehicles` — `registration_no` (unique), `vehicle_type`
  (`own|hired`), `carton_capacity`, `is_active`, `remarks`.
- `dispatch_planner_settings` — single row.

**Read-only views over other modules** (no dependency the other modules must
care about; they are plain `SELECT`s and the rollback drops them):

- `v_dispatch_planner_pending_lines` — one row per open domestic order item
  with pending dozens, deadline, order date, customer, city, product, grade,
  planning item, packing dozens, cartons, overdue flag.
- `v_dispatch_planner_fg_stock` — per planning item: latest
  `daily_stock_closing` quantity, its date, stale flag.
- `v_dispatch_planner_grade_ball_stock` — per grade: BALL bucket balance from
  the grade ledger functions.
- `v_dispatch_planner_open_job_orders` — per planning item (and grade when
  present): Draft/Issued quantities, earliest `required_by_date`.
- `v_dispatch_planner_working_days` — calendar for the horizon with Sundays
  and `public_holidays` marked.

**Functions** (all `SECURITY DEFINER` with the module's role check):

- `dispatch_planner_suggest(p_from, p_to)` — returns the §1A rows. **Writes
  nothing**; the board renders its result and keeps edits in client state
  until "Save as version".
- `dispatch_planner_shortage(p_from, p_to, p_include_unplanned)` — §1B rows.
- `dispatch_planner_capacity_check(p_from, p_to)` — phase 2, hours per
  department.
- `dispatch_planner_version_save(p_payload jsonb)`, `_delete(p_id)`.
- `dispatch_planner_version_vs_actual(p_id)` — §1C, read-only join.
- `dispatch_planner_pin_save`, `_pin_clear`, `_pins_cleanup`.
- `dispatch_planner_vehicle_save`, `dispatch_planner_settings_save`.
- `dispatch_planner_digest()` — optional cron, 08:00 PKT: one notification to
  planner roles with overdue and red-shortage counts (uses the existing
  notifications functions; nothing else).

**Not in this module, by decision:** no trigger on `sales_dispatch_items`,
`deadline_change_requests` or `job_orders`; no column on `job_orders`,
`job_order_items`, `sales_orders` or `sales_order_items`; no `?plan_load=`
parameter on the Dispatch page; no job order creation.

Rollback: `supabase/rollbacks/<ts>_dispatch_planner_down.sql` drops the
planner's tables, views, functions and roles. Nothing else is affected.

---

## 6. Printouts and exports

- **Loading suggestions** per day: load, vehicle, then customer → order,
  product, grade, packing, cartons, dozens, badge. For the dispatch office.
- **Suggested job orders** per department, in the Job Orders form layout, with
  the "for orders" column. For production to type in.
- **Shortage list** by planning item + grade. For the planning meeting.
- **Pending lines** CSV.

All through the existing `pdfBuilder` / `printDocument` helpers.

---

## 7. Phasing and estimate

| Phase | Delivers | Size |
|---|---|---|
| **1 — Suggested dispatch plan** | Roles, planner tables, read-only views, `suggest` function with the §1A rules, week board with drag / pin / re-suggest, Pending Lines page, Vehicles master, Settings, Dashboard, loading-suggestion print, save as version, doc | ~3–4 days |
| **2 — Shortage, suggested job orders, plan vs actual** | `shortage` function, Shortage & Suggested Job Orders page with department sheets, Plan vs Actual page, capacity-hours warning, daily digest | ~2–3 days |
| **3 — Extras** | Export segment behind the setting; weight / CBM per carton if wanted; whatever the plan-vs-actual numbers say is missing | ~1–2 days |

Each phase has its own migration and rollback and is usable on its own.

---

## 8. What would change if the business later wants the planner to act

Listed only so the line is clear. Each is a separate decision and a separate
plan, none is part of this module:

- pre-filling the Dispatch page from a load (a change to the Sales module);
- creating job orders from the suggested sheets (a change to the Planning
  module, and `job_order_items.grade_id`);
- marking plan lines dispatched automatically (a trigger on `sales_dispatch_items`);
- recording closing stock per grade (a change to Daily Stock Closing).

The planner's saved versions and views are designed so that any of these can
be added later without redoing phase 1 or 2.

---

## 9. What this builds on (file references)

- Sales orders: `sales_orders.expected_dispatch_date` is mandatory on domestic
  orders (`src/components/sales/DomesticSalesOrdersPage.tsx:566`); statuses are
  `draft, confirmed, in_production, ready, partially_dispatched, dispatched,
  delivered, cancelled` (migration `20260112200932`); `quantity_dispatched` is
  trigger-maintained from `sales_dispatch_items`.
- Pending is computed client-side as `quantity_dozens − quantity_dispatched` in
  `DomesticDispatchPage.tsx:210` and `DomesticOrderStatusPage.tsx:96`; the
  planner's view does the same in SQL and leaves those pages alone.
- Dispatch: `sales_dispatches`, `sales_dispatch_orders`, `sales_dispatch_items`
  (`order_item_id`, `quantity_dozens`, `packages`); save chain in
  `DomesticDispatchPage.tsx:216-330` (untouched).
- Job orders: `job_orders` (`JO-YY-NNNN`, `Draft/Issued/Closed`, `department_id`,
  `required_by_date`) and `job_order_items` (`planning_item_id`, `quantity`,
  no grade); UI `src/pages/planning/JobOrdersPage.tsx`; eligibility list
  `job_order_eligible_departments`; consumer `ProductionCoordinatorPage.tsx:162-270`.
- Stock: `daily_stock_closing` per `planning_item_id`; `products.planning_item_id`
  (migration `20260801160000`); Grade Stock Ledger BALL bucket per grade
  (migration `20260926120000_grade_stage_ledger.sql`, `src/lib/gradeLedger.ts`).
- Capacity: `capacity_master` (`capacity_per_hour`, `capacity_per_day`,
  `working_hours_per_day`).
- Working days: Sundays and `public_holidays`, as in the Production Coordinator.
- Packing: `packing_types.dozens` → cartons (`DomesticDispatchPage.tsx:518-521`).
- Drag and drop: native HTML5, `src/pages/projects/ProjectKanbanPage.tsx:178-239`.
- Module pattern to copy: `docs/STORE_PASS_PLAN.md`, migrations
  `20261008120000_store_pass_roles.sql`, `20261008120100_store_pass.sql`.

---

## 10. Remaining questions

1. **Ordering rule**: deadline then order date (recommended). Should customer
   category or order value ever jump the queue?
2. **Load grouping**: by city then customer (recommended), or by customer only?
3. **Unplanned lines on the shortage board**: include every pending line due in
   the horizon by default (recommended), with a toggle to show only lines the
   board placed?
4. **Stale stock**: how old may the latest daily closing be before the board
   flags it (recommended: 1 working day)?
5. **Daily digest**: wanted at all, and to which planner roles?
