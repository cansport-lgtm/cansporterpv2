# Dispatch Planner

A **read-only planner**. It reads the pending domestic sales order lines, the
latest finished-goods closing stock, the factory calendar and its own fleet
master, and **suggests** a dispatch day and a load for every pending line. It
never creates a dispatch, a job order, a stock movement or a voucher, adds no
trigger or column to any other module's tables and changes no other page. The
office still makes the DC on the Domestic Dispatch page; production still types
the job orders on the Job Orders page, using the planner's printouts.

Plan and decisions: `docs/DISPATCH_PLAN_JOB_ORDER_PLANNER_PLAN.md`.
Phase 1 (this doc) is the suggested dispatch plan. Phase 2 adds the shortage
board with suggested job orders and plan-vs-actual.

```
                 ┌─────────────────── READS ONLY ────────────────────┐
sales_orders / items · customers · products · grades · planning_items · packing_types
daily_stock_closing · public_holidays
                 └───────────────────────┬───────────────────────────┘
                                         ▼
                        DISPATCH PLANNER (dispatch_planner_* tables only)
                   suggested days & loads · pins · saved versions · vehicles · settings
                                         │ printouts / export
                                         ▼
      office makes DCs (existing page)          production makes JOs (existing page)
```

## 1. The suggestion (`dispatch_planner_suggest(p_from, p_to)`)

One row per pending line, two when stock covers only part of it (`part` 1 from
stock, `part` 2 to be produced). Writes nothing.

1. **Order**: urgent first, then deadline (`sales_orders.expected_dispatch_date`),
   then order date. A **pin** fixes a line's day.
2. **Stock on paper**: the latest `daily_stock_closing` of the product's
   planning item is allocated in that order. A line is `dispatchable` (all of
   it), `partial` (some) or `needs_production` (none). A product with no
   planning item is flagged `no_stock_link` and taken as available; an item
   with no closing ever is `no_closing` and taken as nil.
3. **Day**: a stock-covered row goes on the earliest working day from today up
   to the deadline that still has fleet carton capacity. Past the deadline it
   goes on today, flagged `overdue`. If nothing is free before the deadline it
   is placed on the deadline and flagged `over_fleet_capacity`.
4. **Loads**: within a day, rows are grouped by city then customer, each load
   up to one vehicle's carton capacity (biggest active vehicles first; a load
   beyond the fleet count is flagged `second_trip`). With no vehicles, one load
   per day and no capacity check.
5. **Production**: a `needs_production` row is placed `lead_time_days` working
   days from today and flagged `will_be_late` when that is after the deadline.
   It cannot be pinned (`pin_ignored`).

Cartons = dozens ÷ `packing_types.dozens` matched on the line's packing label
(`no_packing` → 12 assumed). Working days skip Sundays and active
`public_holidays` (both switchable). Every row carries `reason`, the rule that
placed it, and `flags`.

## 2. Pages (sidebar group **Dispatch Planner**, module `dispatch_planner`, routes `/dispatch-planner/*`)

| Page | Route | What it shows |
|---|---|---|
| Dashboard | `/dispatch-planner/dashboard` | Pending lines, overdue, due in 3 / 7 days, from-stock vs needs-production, today's suggested cartons vs fleet, last saved version; today's loads; lines needing attention; short-of-stock by planning item |
| Suggested Plan | `/dispatch-planner/board` | Week board: a column per day (non-working days narrow and grey), loads inside each day with a capacity bar, line cards with status and flags. Drag a stock-covered card to another day to **pin** it; click a card for the reason, flags, pin / urgent / note. Re-suggest, Save as version, print a day's loading sheet |
| Pending Lines | `/dispatch-planner/pending` | Flat table of every pending line with filters (status, flag, customer, search) and Excel export |
| Saved Versions | `/dispatch-planner/versions`, `/versions/:id` | Snapshots saved from the board; open one to see and print its days. Plan vs actual comes in phase 2 |
| Vehicles | `/dispatch-planner/vehicles` | Planner-owned fleet master: registration, own / hired, carton capacity, transporter, default driver, active |
| Settings | `/dispatch-planner/settings` | Horizon, lead time (one value), stale-closing days, Sunday off, public holidays; preview of the next 14 days (super admin) |

Printout **Suggested loading** per day: load, vehicle, customer groups, order,
product, grade, packing, dozens, cartons, deadline, tick boxes, with the note
that nothing has been dispatched or booked. No prices anywhere.

## 3. Roles

| Role | Can |
|---|---|
| `dispatch_planner_officer` | Run suggestions, pin / drag / flag lines, save versions, print, export |
| `dispatch_planner_manager` | Everything above, plus the vehicle master and deleting versions |
| `dispatch_planner_viewer` | Read only |
| `sales_order_manager`, `dispatch_operator` | Read all planner pages (module added to their access in `AuthContext`) |
| `super_admin` | Everything, plus Settings |

Roles are enum values in `20261010120000_dispatch_planner_roles.sql`, registered
in `AuthContext` (tier definition `dispatch_planner` → `/dispatch-planner`),
`ProtectedRoute`, `RolesPage`, `UsersPage` and the sidebar. The database
functions check the role again (`dispatch_planner_can`).

## 4. Database (`20261010120100_dispatch_planner.sql`)

Planner-owned tables, read-only to clients, writes via role-checked functions:

- `dispatch_planner_settings` — single row: `horizon_days`, `lead_time_days`,
  `stale_closing_days`, `sunday_off`, `use_public_holidays`, `segments`.
- `dispatch_planner_vehicles` — the fleet (unique registration, carton capacity).
- `dispatch_planner_pins` — `order_item_id` (no FK, cleaned by
  `dispatch_planner_pins_cleanup`), `pinned_date`, `urgent`, `note`.
- `dispatch_planner_versions` (`DPV-000001`, …) and `dispatch_planner_version_lines`
  — the board as saved.

Read-only views: `v_dispatch_planner_pending_lines` (open domestic lines with
pending dozens, cartons, deadline, planning item), `v_dispatch_planner_fg_stock`
(latest closing per planning item).

Functions: `dispatch_planner_suggest`, `dispatch_planner_working_days`,
`dispatch_planner_add_working_days`, `dispatch_planner_today`,
`dispatch_planner_pin_save` / `_pin_clear` / `_pins_cleanup`,
`dispatch_planner_version_save` / `_version_delete`,
`dispatch_planner_vehicle_save`, `dispatch_planner_settings_save`,
`dispatch_planner_has_any_role`, `dispatch_planner_can`.

**Not in this module, by decision:** no trigger on `sales_dispatch_items`,
`deadline_change_requests` or `job_orders`; no column on `job_orders`,
`job_order_items`, `sales_orders` or `sales_order_items`; no change to the
Dispatch or Job Orders pages; no dispatch or job order creation.

Rollback: `supabase/rollbacks/20261010120100_dispatch_planner_down.sql` drops
the planner's tables, views and functions. Nothing else is affected (the three
enum values stay; remove `user_roles` rows instead).

## 5. Known limits (phase 1)

- Stock is per planning item, not per grade; a grade-wise shortage is phase 2
  and will apportion the item stock across grades by demand share.
- Loads are regrouped on every run; a line can be pinned to a day, not to a
  specific load or vehicle.
- Export orders are not planned (setting reserved).
- The planner reflects the latest closing; if Daily Stock Closing is not
  posted, the board says so with the `stale_stock` / `no_closing` flags.
