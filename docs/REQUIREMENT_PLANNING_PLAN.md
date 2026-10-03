# Requirement Planning (What to Produce) — Module Plan

Status: **Proposal / planning document** (no code changes yet).
Module: `requirement_planning` (`rp_*` schema, `/requirement-planning/*` routes).

Goal, as stated: a module that tells us **which finished products we need to
make, which WIP we need to make, and how much**, by evaluating current stock
against the **thresholds kept in Production Planning** and the **open sales
orders kept in Sales**.

---

## 1. The Question the Module Answers

For every stock item the plant counts, every morning:

```
                 open sales demand          threshold (min)
                        │                        │
   on-hand stock ──►  "Can we ship what is sold?"  ──►  "Will we still be above min after shipping?"
                        │                        │
                        ▼                        ▼
             FG shortfall → MAKE this much FG → WIP needed upstream → MAKE this much WIP
```

Three outputs per item, one row per planning item:

| Output | Meaning |
|---|---|
| **Status** | `Critical` / `Below Min` / `OK` / `Excess` / `Stale count` |
| **Net requirement** | dozens to produce now so that on-hand covers open demand **and** lands back on the threshold |
| **Days of cover** | on-hand ÷ average daily dispatch (last 30 days), so a 500-dozen stock means something different for a fast and a slow grade |

WIP rows carry the same three outputs, but their "demand" is the net requirement
of the finished item(s) they feed, not sales orders directly.

---

## 2. Current State — what already exists, and what is missing

### 2.1 Thresholds (Production Planning)

| Where | Keyed by | Holds | Gap |
|---|---|---|---|
| `planning_items.threshold_inventory` | planning item (department-scoped) | **minimum** only | no max / target, so we know when to start but not when to stop |
| `wip_stage_thresholds.max_threshold` | `wip_stages` (standalone, no link to departments or items) | **maximum** only | cannot be joined to a planning item or a department |
| `inventory_stock.min/max/reorder` | polymorphic `item_type` + location | min/max/reorder | `inventory_stock.quantity` is hand-edited and unused by production; `item_type` is inconsistent (`product` vs `finished_goods`) |

Set in UI: `src/pages/planning/PlanningItemMasterPage.tsx:411-421` ("Threshold
Inventory"). Read today only to colour a row red in
`ProductionPlanningDashboard.tsx:504-507` and
`InventoryValuationDashboard.tsx:171-172`.

**Decision:** the planning item is the right unit (it is what the store counts
daily and what job orders / requirements are raised against). The WIP module's
stage thresholds stay as they are for stage-bottleneck monitoring; they are not
the input to this module (see §7, phase 3).

### 2.2 Stock (Production Planning)

`daily_stock_closing` — one row per `(closing_date, planning_item_id)`,
`closing_quantity` in dozens (`entered_quantity × multiplier`). Written by
`DailyStockClosingPage.tsx:147-167` ("Save All" upserts every active item).

On-hand = **latest closing on or before the as-of date**, exactly as
`accounting_inventory_snapshot(p_as_of)` already does
(`supabase/migrations/20260831120000_*.sql:7-40`). We reuse that definition
verbatim so Accounting's valuation and this module never disagree on stock.

**FG vs WIP is decided by department**: a planning item in the Packing
department is finished goods; every other department is WIP
(`InventoryValuationDashboard.tsx:166-169`). Non-`standard` `stock_category`
items (cpa / leak / rejection / lot) are **not** available stock and are
excluded from on-hand.

Gaps:

1. Stock is a **count, not a ledger**. If the store skips a day, the latest
   closing is stale and the module must say so rather than plan on it.
2. `opening_quantity` is never written (always 0), so day-over-day movement
   cannot be derived from this table alone.

### 2.3 Demand (Sales)

`sales_orders` (header: `status`, `required_date`, `expected_dispatch_date`,
`sales_segment`) → `sales_order_items` (`product_id → products`, `grade_id`,
`quantity_dozens`, `quantity_dispatched`). `quantity_dispatched` is maintained
by the `update_dispatched_qty` trigger from `sales_dispatch_items`.

Open quantity per line = `quantity_dozens − quantity_dispatched` — the same
formula every dispatch page already uses (`DispatchPageBase.tsx:122-127`,
`SalesOrdersPage.tsx:1083-1085` "Pending Dz").

Sales lines are in **`products`**; stock is in **`planning_items`**. The bridge
is `products.planning_item_id` (many products → one planning item, e.g. packing
variants; `20260801160000_product_planning_item_link.sql`). Products with no
link are already surfaced by `production_unmapped_sales`.

Gaps found while mapping (these distort any demand figure today):

1. **Status vocabulary mismatch.** The CHECK on `sales_orders.status` allows
   `draft, confirmed, in_production, ready, partially_dispatched, dispatched,
   delivered, cancelled`, but the UI and the status trigger also use
   `in_progress` and `completed`
   (`SalesOrdersPageBase.tsx:627`, `DomesticSalesOrdersPage.tsx:1158`,
   `20260403035012_*.sql`). Writes of those values fail the CHECK or never happen.
2. **Trigger ordering.** `trg_update_order_status_on_dispatch` sorts before
   `update_dispatched_qty`, so the status trigger likely reads the *old*
   `quantity_dispatched`; orders can sit in the wrong status. The backfill in
   `20260417191947_*.sql` is consistent with this.
3. **The only existing demand calculation is wrong for our purpose.**
   `ProductionPlanningDashboard.tsx:75-93,160-179` sums gross
   `quantity_dozens` (not pending), filters on `in_progress` (not a valid
   status), limits to `required_date` in the current week, and keys by
   `product_id` (not planning item). It must not be the base for this module.
4. **Sales returns** (`processSalesReturn.ts`) do not reduce
   `quantity_dispatched`; returned goods therefore do not reopen demand. This
   is acceptable (returns are a separate decision) but must be documented in
   the module's definition of demand.
5. Dates are **order-level only**; there is no per-line required date.

### 2.4 FG → WIP structure

There is **no table linking a finished planning item to the WIP items that
feed it**. What exists:

- `production_wip_sequence` — department order (levels), used by
  `WIPLedgerPage` / `WIPReconciliationPage`.
- The grade ledger (`20260926120000_grade_stage_ledger.sql`) hard-codes
  PRESS → JORR → LOCAL_FINAL / FANCY_FINAL and treats the flow as **1 : 1 per
  grade** (one core becomes one covered ball becomes one packed ball).
- `planning_items.parent_planning_item_id` exists in the live DB
  (`types.ts:10557`, FK `planning_items_parent_planning_item_id_fkey`) but no
  migration in the repo creates it and no code reads it. Its intended meaning
  is unknown.
- `consumption_bom` is product → raw material, `floor_inventory_bom` is
  free-text; neither is a WIP routing.

Without a feed link, the module can report WIP stock vs WIP threshold, but it
cannot say "we need 300 dz more cores *because* Packing is short of grade X".
That link is the one new master-data element this module needs (§3.2).

### 2.5 Things we build on

- `accounting_inventory_snapshot` — the latest-closing-per-item pattern.
- `production_monthly_report` / `production_unmapped_sales` — RPC style,
  `SECURITY DEFINER`, `GRANT EXECUTE … TO anon, authenticated, service_role`.
- `production_requirements` / `production_requirement_items`
  (`planning_item_id`, `required_qty`, `required_by`) — the existing hand-off
  document the plan can create.
- `capacity_master` (`department_id`, `product_id`, `capacity_per_day`) — for
  "how many days will this take" (phase 2).
- `useAppSetting` hook + `app_settings` — for module defaults.
- Module tier roles `<prefix>_manager / _officer / _viewer` pattern
  (`20260930120000_add_production_role_tiers.sql`, `AuthContext.tsx` tier
  definitions).
- `docs/SYSTEM_NOTIFICATIONS.md` — for "item went critical" alerts (phase 2).

---

## 3. Recommended Design

### 3.1 Principles

1. **Compute, don't copy.** Thresholds stay in Planning Item Master; demand
   stays in Sales; stock stays in Daily Stock Closing. The module owns a
   *calculation* and its *settings*, not a second copy of any of those.
2. **One definition of each input**, in SQL, reused by everything: on-hand,
   open demand, threshold, feed link. Pages never re-derive them in TypeScript.
3. **Say when the answer is unreliable.** Stale counts, unmapped products and
   orders with a broken status are shown as warnings on the same screen, not
   hidden.

### 3.2 Master-data additions (two columns, one small table)

```sql
-- Planning Item Master: when to stop producing, and what the item feeds
ALTER TABLE public.planning_items
  ADD COLUMN IF NOT EXISTS target_inventory NUMERIC;   -- NULL = replenish only to threshold_inventory

COMMENT ON COLUMN public.planning_items.target_inventory IS
  'Order-up-to level in the item unit. Requirement planning produces up to this; NULL falls back to threshold_inventory. Must be >= threshold_inventory when set.';

-- Which item this item becomes at the next stage (the WIP routing)
CREATE TABLE public.rp_item_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_planning_item_id UUID NOT NULL REFERENCES public.planning_items(id) ON DELETE CASCADE,
  to_planning_item_id   UUID NOT NULL REFERENCES public.planning_items(id) ON DELETE CASCADE,
  qty_per_unit NUMERIC NOT NULL DEFAULT 1 CHECK (qty_per_unit > 0),  -- from-units consumed per 1 to-unit
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_planning_item_id, to_planning_item_id),
  CHECK (from_planning_item_id <> to_planning_item_id)
);
```

Why a table rather than `parent_planning_item_id`: a Local Final item and a
Fancy Final item may both feed the same packed item, and one WIP item may feed
two packed variants. A single parent pointer cannot express either. If the
plant confirms the flow is strictly a tree, `parent_planning_item_id` can be
the Phase 0 backfill source for this table.

Default `qty_per_unit = 1` matches the grade ledger's 1 : 1 flow; the column
exists so a 12-dozen carton item fed by a 1-dozen item can be expressed later.

A cycle guard (trigger or CHECK via recursive CTE) is required, because the
requirement explosion walks this graph.

### 3.3 Settings (`app_settings`, via `useAppSetting`)

| Key | Default | Meaning |
|---|---|---|
| `rp.demand_statuses` | `confirmed, in_production, ready, partially_dispatched` | sales order statuses counted as open demand |
| `rp.demand_segments` | all (`private_label, domestic, export`) | segments included |
| `rp.horizon_days` | `14` | orders due within this window count as **committed**; later orders are shown but flagged **future** |
| `rp.stale_days` | `2` | a closing older than this marks the row `Stale count` |
| `rp.cover_window_days` | `30` | window for average daily dispatch |
| `rp.fg_department_codes` | `PACKING` | which departments are finished goods |

### 3.4 The calculation (one RPC)

`rp_requirement_plan(p_as_of DATE, p_horizon_days INT)` → one row per active
planning item (`stock_category = 'standard'`):

```
on_hand        = latest daily_stock_closing.closing_quantity ON OR BEFORE p_as_of
closing_age    = p_as_of − that closing_date
min_level      = threshold_inventory
target_level   = COALESCE(target_inventory, threshold_inventory)

-- Finished goods only
demand_committed = Σ GREATEST(quantity_dozens − quantity_dispatched, 0)
                   over sales_order_items ⨝ sales_orders
                   where status ∈ rp.demand_statuses
                     and segment ∈ rp.demand_segments
                     and COALESCE(expected_dispatch_date, required_date) ≤ p_as_of + horizon
                   mapped via products.planning_item_id
demand_future    = same, for dates beyond the horizon (or NULL date)

available_after_demand = on_hand − demand_committed
net_requirement_fg     = GREATEST(demand_committed + target_level − on_hand, 0)

-- WIP: explode downstream requirement upstream through rp_item_feeds
downstream_need(w) = Σ over feeds (w → f): net_requirement(f) × qty_per_unit
net_requirement_wip = GREATEST(downstream_need + target_level − on_hand, 0)
                      (walk in production_departments.sequence_order, last stage first,
                       so Packing need → Final need → Jorr need → Press need)

days_of_cover = on_hand ÷ (Σ sales_dispatch_items.quantity_dozens over the last
                rp.cover_window_days, mapped to the planning item ÷ window)   -- FG only

status:
  Stale count   closing_age > rp.stale_days        (shown first; still computed)
  Critical      available_after_demand < 0          (cannot ship what is sold)
  Below Min     available_after_demand < min_level
  Excess        target_inventory IS NOT NULL AND on_hand > target_inventory AND demand_committed = 0
  OK            otherwise
```

Why an RPC: one round trip, one definition, reusable by the dashboard, by the
hand-off (§3.6) and by a nightly notification job. It mirrors
`production_monthly_report`. Pages call it with `supabase.rpc` and fall back
to a disabled state (not a client-side recomputation) when the function is
missing, following `inventoryValuation.ts`.

A second RPC, `rp_requirement_detail(p_planning_item_id, p_as_of, p_horizon)`,
returns the open order lines (order number, customer, product, pending dz, due
date) and the closing history behind one row, for the drawer.

### 3.5 Pages (`/requirement-planning/*`)

| Route | Page | Content |
|---|---|---|
| `/requirement-planning/dashboard` | **Requirement Dashboard** | as-of date + horizon picker; KPI tiles (Critical, Below Min, Excess, Stale counts, Unmapped sales lines); **Finished Goods** table and **WIP** table, both: item, dept, on-hand (with closing date), min / target, committed demand, future demand, available after demand, net requirement, days of cover, status. Sorted Critical → Below Min → Stale → OK → Excess. Row click opens the detail drawer. |
| drawer | **Item detail** | open order lines feeding demand; 14-day closing trend; which items this feeds / is fed by; threshold values with a link to Planning Item Master |
| `/requirement-planning/feeds` | **Item Feeds** | maintain `rp_item_feeds` as a stage-ordered list (from item → to item, qty per unit); shows items in non-FG departments that feed nothing (orphans) |
| `/requirement-planning/data-quality` | **Data Quality** | unmapped products with open orders (`production_unmapped_sales` logic over open lines, not dispatches); orders with a status outside the CHECK; items with no closing in N days; items whose target < min |
| `/requirement-planning/settings` | **Settings** | the `rp.*` settings above |

Thresholds are **not** edited here. Planning Item Master gains the single
`target_inventory` field next to the existing threshold field, so there is one
place to set levels.

### 3.6 Hand-off (make it actionable)

From the dashboard, select rows → **"Create Production Requirement"** →
inserts one `production_requirements` header (`window_from = as-of`,
`window_to = as-of + horizon`, title "Requirement plan <date>") and one
`production_requirement_items` row per selected item with
`required_qty = net_requirement`, `required_by = earliest committed due date`.
That is the document the Production Coordinator already works from, so nothing
new is needed downstream; the plan row records `created_requirement_id` so the
dashboard can show "already raised" instead of nagging.

### 3.7 Access

- Sidebar module `Requirement Planning` (`module: "requirement_planning"`),
  prefix `/requirement-planning`, registered in `MODULE_ROUTE_PREFIXES`,
  `ModulePermissionsForm` keys and the sidebar.
- Tier roles `requirement_planning_manager` (settings, feeds, hand-off),
  `requirement_planning_officer` (dashboard + hand-off), `requirement_planning_viewer`
  (dashboard read-only), added the same way as the production tiers.
- Planning and Sales managers get `can_view` by default so the screen is useful
  on day one without a role change.
- Tables get the repo's permissive RLS + GRANTs (custom auth; enforcement is
  front-end, as everywhere else).

---

## 4. Prerequisites (fix before trusting any number)

These are small and independent of the new module, but the module's output is
wrong until they are done:

1. **Sales status vocabulary.** Either extend the CHECK to include
   `in_progress` / `completed`, or change the UI and trigger to the allowed
   values. One migration plus three code sites (§2.3 item 1).
2. **Dispatch trigger order.** Rename or merge so the quantity trigger runs
   before the status trigger (e.g. make the status update part of
   `update_dispatched_qty`, or prefix the names `a_` / `b_`). Re-run the
   status backfill afterwards.
3. **Product → planning item mapping.** Every product with an open order must
   have `planning_item_id`. The Data Quality page lists the gaps; Sales/Master
   Data fills them in `ProductsPage`.
4. **Thresholds populated.** `threshold_inventory` defaults to 0, which makes
   every item "OK" until it runs out. Items with threshold 0 are listed on the
   Data Quality page as "no threshold".

---

## 5. Decisions Needed From the Plant

| # | Question | Default if unanswered |
|---|---|---|
| 1 | Is finished goods exactly "planning items in the Packing department"? Any other department that holds sellable stock? | Packing only |
| 2 | What does the live `planning_items.parent_planning_item_id` mean today, and is the FG → WIP flow strictly 1 : 1 per grade (one core → one ball → one packed ball)? | 1 : 1; `parent_planning_item_id` ignored |
| 3 | Which sales statuses count as demand? Should `draft` orders count, or be shown separately as "unconfirmed"? Do all three segments count? | confirmed, in_production, ready, partially_dispatched; all segments; draft shown as a separate column, not counted |
| 4 | Replenish to the **threshold** only, or to a **target** above it? (Produce-to-min causes constant small runs; produce-to-target batches work.) | add `target_inventory`; NULL = threshold |
| 5 | Horizon for "committed" demand: 7, 14 or 30 days? | 14 |
| 6 | How old may a closing count be before we refuse to plan on it? | 2 days |
| 7 | Should WIP stage maximums from the WIP module (`wip_stage_thresholds`) also cap WIP net requirement? That needs a `wip_stages → production_departments` mapping that does not exist. | Phase 3 |
| 8 | Should `Excess` consider future (beyond-horizon) demand before flagging? | no; future demand shown, not netted |

---

## 6. Worked Example

Grade LB, as-of 3 Oct, horizon 14 days, 1 : 1 feeds Press → Jorr → Local Final → Packing.

| Item (dept) | On-hand | Min | Target | Committed demand | Downstream need | Net requirement | Status |
|---|---|---|---|---|---|---|---|
| LB Packed (Packing) | 400 | 300 | 600 | 650 | — | 650 + 600 − 400 = **850** | Critical (400 − 650 < 0) |
| LB Covered (Local Final) | 200 | 150 | 300 | — | 850 | 850 + 300 − 200 = **950** | Below Min after need |
| LB Core (Jorr) | 1,200 | 400 | 800 | — | 950 | 950 + 800 − 1,200 = **550** | OK on hand, needs top-up |
| LB Cup (Press) | 3,000 | 500 | 1,000 | — | 550 | max(550 + 1,000 − 3,000, 0) = **0** | Excess (3,000 > 1,000, no demand) |

Reading: ship nothing until Packing packs 650; Packing needs 850 covered balls
it does not have; Press should stop making LB cups. That is the sentence the
module exists to produce.

---

## 7. Phasing

**Phase 0 — groundwork (no UI)**
Prerequisites §4; `target_inventory` column + field in Planning Item Master;
`rp_item_feeds` table + cycle guard; roles migration; `rp.*` settings seeded.

**Phase 1 — read-only answer**
`rp_requirement_plan` and `rp_requirement_detail` RPCs; Requirement Dashboard
with FG and WIP tables and the detail drawer; Item Feeds page; Data Quality
page. This alone delivers "what FG and WIP do we need".

**Phase 2 — act on it**
Hand-off to `production_requirements`; `capacity_master` days-to-produce column;
"item went Critical" via the existing system notifications; nightly snapshot
table `rp_plan_snapshots` so yesterday's recommendation can be compared with
what was actually produced.

**Phase 3 — refine**
Map `wip_stages` to departments and let `wip_stage_thresholds.max_threshold`
cap WIP requirements; forecast demand from dispatch history for items with no
open orders; per-customer or per-segment demand split.

---

## 8. Out of Scope (deliberately)

- Raw-material requirements (`consumption_bom` / purchase) — a separate MRP step
  that can consume this module's WIP requirement later.
- Replacing the WIP module, the grade ledger or floor inventory. This module
  reads planning closings only; reconciling the four WIP systems is its own
  project (`WIPReconciliationPage` already starts it).
- Scheduling (which machine, which shift). We produce quantities and due dates;
  Weekly Planning and Job Orders remain the scheduling tools.
