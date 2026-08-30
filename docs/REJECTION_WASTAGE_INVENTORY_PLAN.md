# Rejection & Wastage Inventory Tracking — Module Plan

Status: **Proposal / planning document** (no code changes yet).
Module: `rejections_wastages` (`rw_*` schema, `/rejections/*` routes).

---

## 1. Current State (what we're building on)

The Rejections & Wastage module today is an **event log, not an inventory**:

| Table | What it holds | Inventory effect |
|---|---|---|
| `rw_rejections` | date, dept, sub-dept, process, product/material, shift, `rejected_qty`, disposition (`scrap`/`rework`), `rework_qty`, `rework_status`, reason, `unit_cost`, `total_cost` | **none** |
| `rw_wastages` | date, dept, material, shift, `wasted_qty`, reason, cost | **none** |
| `rw_leakages` | date, dept, process, material, shift, `leaked_qty`, reason, cost | **none** |
| `rw_materials` | `hp_material_id` → unit + `unit_cost` | master only |
| `rw_dispositions` | `name`, `name_urdu`, `description`, `is_active` | **name only — carries no behaviour** |
| `rw_reasons` | `rejection` / `wastage` / `leakage` reasons | master only |
| `rw_units` | symbol + name | master only |

Consequences of this today:

1. **Nothing is verifiable.** A quantity typed into `RejectionsWastageEntryPage` is accepted as truth. There is no downstream physical object the number has to agree with, so under-reporting (hiding rejections) and over-reporting (covering a theft or a production shortfall) are both invisible.
2. **Scrap has no custody.** Rejected pieces and collected waste physically sit in bins/scrap yards and are later sold, destroyed, recycled or reworked. None of that is recorded, so material can leave the premises with no book trail.
3. **Rework is open-ended.** `rework_status` moves `pending → in_progress → completed` by a button press. Nothing checks that the reworked pieces actually came back to production, or that the rework bin is empty when the status says it is.
4. **Dispositions are inert.** The master exists and is selected on every entry, but the value does not drive any behaviour.
5. **Analytics measures cost, not truth.** `RejectionsAnalyticsPage` totals qty and value; it cannot report accuracy.

The rest of the ERP already has the patterns we need, and we should mirror them rather than invent new ones:

- `inventory_locations` / `inventory_stock` / `stock_movements` / `inventory_ledger` — location + on-hand cache + movement + running-balance ledger (main store).
- `floor_inventory_*` — the same four-table shape scoped to the production floor.
- `consumption_stock_closing` — opening + receipts − closing = derived actual, with a `UNIQUE(closing_date, raw_material_id)` per-period row; `closing_frequency` daily/weekly.
- `consumption_grn_cutover()` / `consumption_production_sync_cutover()` — a dated cutover so a new automated behaviour applies from a chosen date forward and pre-cutover history is left alone.
- `enforce_consumption_manual_entry_guard()` — a DB-level trigger that rejects manual writes the system now owns.
- `lock_invoiced_dispatch_items` — locking rows once a downstream document exists.
- Role tiers `rejections_manager` / `rejections_officer` / `rejections_viewer` (+ `super_admin` for deletes), wired in `AuthContext.tsx` via `MODULE_TIER_DEFINITIONS`.

---

## 2. The Core Idea

**Rejection and wastage output is itself physical stock.** A rejected can, a bag of cut-off trims, a drum of contaminated coating — all of it exists, occupies a bin, and eventually leaves the site as a scrap sale, a destruction, a supplier return or a reworked good piece.

So we turn the R&W module into a small, self-contained inventory:

```
   Rejection / Wastage / Leakage entry   →  STOCK IN   →  ┌──────────────┐
                                                          │ Scrap /      │
   Rework completed → back to production →  STOCK OUT  ←  │ Rework bin   │
   Scrap sale / destruction / return     →  STOCK OUT  ←  │ (rw_stock)   │
                                                          └──────────────┘
                                                                  ↕
                                                    PHYSICAL COUNT → variance
```

The physical count is the authentication mechanism. If someone books 500 rejected pieces that do not exist, the scrap-yard count comes up 500 short and the variance report names the department, the date range and the user who entered it. If someone hides 500 rejections that do exist, the count comes up 500 long. Either way the fed data is now falsifiable — which is exactly what "authenticate the data" requires.

---

## 3. Data Model

All new tables keep module conventions: `rw_` prefix, UUID PK, `created_at`/`updated_at` + the shared `update_updated_at_column()` trigger, RLS enabled with the module's existing permissive policy shape.

### 3.1 Make the existing masters carry behaviour

Right now nothing in the schema knows whether a given disposition or material *produces physical residue*. This is the single most important addition — without it every count would show a variance for evaporation and liquid leakage, and the whole system would be dismissed as noisy.

```sql
-- Dispositions become the routing rule for stock.
ALTER TABLE rw_dispositions
  ADD COLUMN stock_effect TEXT NOT NULL DEFAULT 'scrap_in'
    CHECK (stock_effect IN ('scrap_in','rework_in','none','consume')),
  ADD COLUMN default_location_id UUID REFERENCES rw_locations(id);
--   scrap_in   → adds to the scrap bin, awaits disposal
--   rework_in  → adds to the rework bin, leaves on rework completion
--   none       → no residue (evaporation, gas leak, moisture loss)
--   consume    → consumed on the spot, never held (e.g. destroyed at machine)

-- Materials say whether the residue is collectible and how tightly it is counted.
ALTER TABLE rw_materials
  ADD COLUMN is_recoverable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN default_location_id UUID REFERENCES rw_locations(id),
  ADD COLUMN variance_tolerance_pct NUMERIC NOT NULL DEFAULT 2,
  ADD COLUMN count_frequency TEXT NOT NULL DEFAULT 'weekly'
    CHECK (count_frequency IN ('daily','weekly','monthly','none'));
```

`variance_tolerance_pct` and `count_frequency` per material mirror `consumption_raw_materials.closing_frequency` — some scrap (brass, tinplate) is worth counting daily; floor sweepings are not.

### 3.2 `rw_locations` — where rejected/wasted material is held

```sql
CREATE TABLE rw_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_urdu TEXT,
  location_type TEXT NOT NULL DEFAULT 'scrap'
    CHECK (location_type IN ('scrap','rework','quarantine','disposal_staging')),
  department_id UUID REFERENCES production_departments(id),
  inventory_location_id UUID REFERENCES inventory_locations(id),  -- optional bridge to the main store
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Why a separate table instead of reusing `inventory_locations`:** scrap bins are department-scoped shop-floor holding points with a different lifecycle from store racks, and mixing them would pollute the main store's stock and valuation reports. The `inventory_location_id` bridge column keeps the door open for "transfer approved scrap into the main store" later, without forcing it now.

### 3.3 `rw_stock_ledger` — every movement, with running balance

The heart of the design. Same shape as `inventory_ledger`, so it will read as familiar code.

```sql
CREATE TABLE rw_stock_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  location_id UUID NOT NULL REFERENCES rw_locations(id),
  item_kind TEXT NOT NULL CHECK (item_kind IN ('material','product')),
  item_id UUID NOT NULL,                       -- hp_materials.id or products.id
  unit TEXT NOT NULL DEFAULT 'pcs',
  department_id UUID REFERENCES production_departments(id),

  quantity_in  NUMERIC NOT NULL DEFAULT 0,
  quantity_out NUMERIC NOT NULL DEFAULT 0,
  balance_quantity NUMERIC NOT NULL,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  value_in  NUMERIC NOT NULL DEFAULT 0,
  value_out NUMERIC NOT NULL DEFAULT 0,
  balance_value NUMERIC NOT NULL,

  source_type TEXT NOT NULL CHECK (source_type IN
    ('rejection','wastage','leakage','rework_return','disposal','count_adjustment','transfer','opening')),
  source_id UUID,                              -- the rw_rejections / rw_disposals / rw_stock_counts row
  reference_number TEXT,
  remarks TEXT,
  entered_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent posting: one ledger row per source document line.
CREATE UNIQUE INDEX rw_stock_ledger_source_uk
  ON rw_stock_ledger (source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX rw_stock_ledger_item_idx ON rw_stock_ledger (item_kind, item_id, txn_date);
CREATE INDEX rw_stock_ledger_loc_idx  ON rw_stock_ledger (location_id, txn_date);
```

`item_kind` is needed because `rw_rejections` already carries **both** `product_id` (a rejected finished/semi-finished piece) and `material_id` (a rejected input), while `rw_wastages`/`rw_leakages` are material-only.

### 3.4 `rw_stock` — on-hand cache

```sql
CREATE TABLE rw_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES rw_locations(id),
  item_kind TEXT NOT NULL CHECK (item_kind IN ('material','product')),
  item_id UUID NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  stock_value NUMERIC NOT NULL DEFAULT 0,
  last_movement_date TIMESTAMPTZ,
  last_counted_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, item_kind, item_id)
);
```

Maintained by an `AFTER INSERT/UPDATE/DELETE` trigger on `rw_stock_ledger` — the ledger stays the source of truth, `rw_stock` is a derived read cache (same relationship as `inventory_ledger` ↔ `inventory_stock`).

### 3.5 `rw_disposals` + `rw_disposal_items` — how scrap leaves

```sql
CREATE TABLE rw_disposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disposal_number TEXT UNIQUE,                 -- 'RWD-YYYYMM-00001', sequence + trigger (as stock_movements does)
  disposal_date DATE NOT NULL DEFAULT CURRENT_DATE,
  disposal_type TEXT NOT NULL CHECK (disposal_type IN
    ('sale','destruction','return_to_supplier','internal_reuse','transfer_to_store')),
  location_id UUID NOT NULL REFERENCES rw_locations(id),
  party_id UUID REFERENCES accounting_parties(id),   -- scrap buyer / supplier being returned to
  vehicle_number TEXT,
  gate_pass_number TEXT,
  total_quantity NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','posted','cancelled')),
  remarks TEXT,
  created_by UUID REFERENCES app_users(id),
  approved_by UUID REFERENCES app_users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rw_disposal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disposal_id UUID NOT NULL REFERENCES rw_disposals(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('material','product')),
  item_id UUID NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  rate NUMERIC NOT NULL DEFAULT 0,             -- realisation rate for a sale
  amount NUMERIC NOT NULL DEFAULT 0,
  book_unit_cost NUMERIC NOT NULL DEFAULT 0,   -- what the book says it was worth
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

A disposal posts **stock OUT** on approval, and only up to the available balance (checked in the posting function). `book_unit_cost` vs `rate` gives the scrap-realisation gain/loss for later GL posting.

### 3.6 `rw_stock_counts` + `rw_stock_count_lines` — the authentication document

```sql
CREATE TABLE rw_stock_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_number TEXT UNIQUE,                    -- 'RWC-YYYYMM-00001'
  count_date DATE NOT NULL DEFAULT CURRENT_DATE,
  location_id UUID NOT NULL REFERENCES rw_locations(id),
  department_id UUID REFERENCES production_departments(id),
  count_type TEXT NOT NULL DEFAULT 'periodic'
    CHECK (count_type IN ('daily','weekly','monthly','spot','periodic')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','posted','cancelled')),
  counted_by  UUID REFERENCES app_users(id),
  verified_by UUID REFERENCES app_users(id),   -- must differ from counted_by (segregation of duties)
  approved_by UUID REFERENCES app_users(id),
  approved_at TIMESTAMPTZ,
  total_variance_qty NUMERIC NOT NULL DEFAULT 0,
  total_variance_value NUMERIC NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, count_date, count_type)
);

CREATE TABLE rw_stock_count_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id UUID NOT NULL REFERENCES rw_stock_counts(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('material','product')),
  item_id UUID NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  system_quantity   NUMERIC NOT NULL DEFAULT 0,   -- frozen snapshot of rw_stock at sheet creation
  physical_quantity NUMERIC NOT NULL DEFAULT 0,
  variance_quantity NUMERIC GENERATED ALWAYS AS (physical_quantity - system_quantity) STORED,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  variance_value NUMERIC GENERATED ALWAYS AS ((physical_quantity - system_quantity) * unit_cost) STORED,
  variance_reason_id UUID REFERENCES rw_reasons(id),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (count_id, item_kind, item_id)
);
```

`system_quantity` is **frozen at sheet creation**, not read live at approval time. Otherwise a late back-dated entry would silently "fix" a variance and the fraud signal would vanish — the exact thing this feature exists to catch.

`variance_quantity` / `variance_value` as generated columns follows `consumption_stock_closing.actual_consumption`, which is already a stored generated column in this schema.

---

## 4. Posting Rules — where each movement comes from

Implemented as `AFTER INSERT/UPDATE/DELETE` triggers on the three entry tables, calling one shared `rw_post_stock_movement()` function.

| Event | Movement | Location | Notes |
|---|---|---|---|
| `rw_rejections` inserted, disposition `stock_effect = 'scrap_in'` | **IN** `rejected_qty` | disposition default → material default → department scrap bin | item = `product_id` if set, else `material_id` |
| `rw_rejections` inserted, `stock_effect = 'rework_in'` | **IN** `rejected_qty` | department rework bin | |
| `rw_rejections.rework_status → 'completed'` | **OUT** `rework_qty` | rework bin | remainder stays as still-pending rework; a completed row with `rework_qty < rejected_qty` posts the shortfall to the scrap bin |
| `rw_wastages` inserted, material `is_recoverable` and disposition ≠ `none` | **IN** `wasted_qty` | material/department waste bin | non-recoverable → no movement |
| `rw_leakages` inserted, material `is_recoverable` | **IN** `leaked_qty` | waste bin | most liquid/gas leakage is `is_recoverable = false` → no movement |
| `rw_disposals` approved | **OUT** each line qty | disposal header location | blocked if it would drive the balance negative |
| `rw_stock_counts` approved | **IN/OUT** the variance | count location | `source_type = 'count_adjustment'`, brings book to physical |
| entry edited | reverse + repost | | never mutate a ledger row in place |
| entry deleted | reverse only | | pre-cutover rows and locked periods refuse the delete |

**Cutover.** Following the `consumption_grn_cutover()` precedent, a `rw_stock_cutover()` function returns a single configurable date. Entries dated **before** it stay pure log rows with no stock effect; entries on/after it post to the ledger. Opening balances are then established by one physical count per location dated on the cutover, posted as `source_type = 'opening'`. This avoids a fake, unverifiable backfill of years of historical entries.

---

## 5. Integrity Controls (what actually makes the data trustworthy)

1. **Period lock after an approved count.** A DB trigger (same shape as `enforce_consumption_manual_entry_guard`) rejects insert/update/delete on `rw_rejections` / `rw_wastages` / `rw_leakages` for a department whose location has an **approved count on or after that entry_date**. Without this, anyone can back-date an entry to explain away a variance. `super_admin` bypass only, and the bypass is logged.
2. **Segregation of duties.** `counted_by ≠ verified_by ≠ approved_by` enforced by a CHECK/trigger. Counting officer records; a second person verifies; a manager approves the adjustment.
3. **No negative balances.** Disposals and rework returns cannot exceed on-hand; the posting function raises instead of writing a negative balance. This alone catches the common case of booking a scrap sale larger than what was ever rejected.
4. **Tolerance-based escalation.** Variance within `rw_materials.variance_tolerance_pct` → officer can post. Beyond it → manager approval required, with a mandatory `variance_reason_id`.
5. **Cross-check against production.** Rejection qty vs the same department/date's produced qty (from the hourly-production tables the module already joins to) gives a rejection %. Entries outside a configured band get flagged on the dashboard — this catches implausible data *at entry time*, before the count catches it a week later.
6. **Entry-accuracy scoring.** Per period, per department, per `entered_by`: |variance| ÷ total booked qty. A user whose entries consistently produce variance is visible without an audit.

---

## 6. UI — new pages under `/rejections`

Wired into `App.tsx` routes and the `rejections_wastages` group in `ERPSidebar.tsx`, following the existing page structure (`ERPLayout` + `PageHeader` + shadcn `Card`/`Table`, `useQuery` against Supabase).

| Route | Page | Tier |
|---|---|---|
| `/rejections/stock` | **Scrap & Rework Stock** — on-hand per location/item with value, age of stock, last counted date | viewer+ |
| `/rejections/ledger` | **R&W Stock Ledger** — every movement with running balance, filters (date/location/item/source), drill-through to the source entry | viewer+ |
| `/rejections/disposals` | **Disposals** — list + create scrap sale / destruction / return, header+lines dialog, approve → posts OUT, printable gate pass | officer creates, manager approves |
| `/rejections/counts` | **Physical Count** — create sheet (auto-fills every item with balance at that location, freezes `system_quantity`), enter physical qty on mobile, live variance colouring, submit → verify → approve → adjust | officer counts, manager approves |
| `/rejections/reconciliation` | **Reconciliation Dashboard** — per period/department: Opening + IN − OUT = Book Closing vs Physical Closing, variance qty/%/value, accuracy score by department and by entry user, overdue-count and out-of-band alerts | viewer+ |
| `/rejections/locations` | **Locations Master** | super admin |

Existing pages get small additions:
- `RejectionsWastageEntryPage` — a location picker (defaulted from disposition/material/department) and a live "current scrap bin balance" hint next to the qty field; disabled inputs for locked periods, mirroring the guard.
- `ReworkTrackingPage` — a "Rework bin balance" column so a *completed* status with a non-empty bin is visible.
- `RejectionsAnalyticsPage` — a variance/accuracy tab.
- `RWDispositionsMasterPage` / `RWMaterialsMasterPage` — the new `stock_effect`, `is_recoverable`, tolerance and count-frequency fields.

---

## 7. Roles

No new role enum values needed — the three-tier set added in `20260829120000_add_module_roles_all_modules.sql` covers this:

- `rejections_viewer` — read stock, ledger, reconciliation.
- `rejections_officer` — create entries, create/submit counts, create draft disposals.
- `rejections_manager` — verify/approve counts, approve disposals, post adjustments beyond tolerance.
- `super_admin` — deletes, period-lock bypass, masters.

The only nuance is that verification must come from a *different user* than the counter; that is enforced per-document (§5.2), not by a new role.

---

## 8. Accounting Hook (deferred, but designed for)

Once the ledger is trustworthy, the numbers become postable:

- Rejection/wastage IN → Dr *Scrap Inventory* / Cr *Manufacturing Loss (Rejection & Wastage)*.
- Scrap sale → Dr *Party* / Cr *Scrap Inventory* + gain or loss on realisation (`rate` − `book_unit_cost`).
- Count adjustment → Dr/Cr *Inventory Shortage / Surplus*.

Out of scope for the first release; the `book_unit_cost`, `rate` and `variance_value` fields are already in the schema so the posting can be added without a migration to the transaction tables.

---

## 9. Phasing

**Phase 1 — Foundation (stock exists)**
`rw_locations`, `rw_stock_ledger`, `rw_stock`, the master flags (`stock_effect`, `is_recoverable`, defaults), the posting function + entry triggers, `rw_stock_cutover()`, Locations master, Scrap Stock page, Stock Ledger page.
*Deliverable: every rejection/wastage from the cutover date lands in a scrap bin with a running balance.*

**Phase 2 — Authentication (physical vs book)**
`rw_stock_counts` / `rw_stock_count_lines`, count sheet UI (mobile-friendly entry), variance calculation, verify/approve flow, count-adjustment posting, the period-lock guard, Reconciliation Dashboard with accuracy scoring.
*Deliverable: the fed data can be proven right or wrong against a physical count, and back-dating is blocked.*

**Phase 3 — Closure & control**
`rw_disposals` / `rw_disposal_items` with gate pass, scrap-sale party link, negative-balance guard, production-rate cross-check and out-of-band flagging, tolerance escalation, optional transfer to main store.
*Deliverable: scrap cannot leave site without a document, and realisation is measured against book value.*

**Phase 4 (optional) — Accounting integration** per §8.

Each phase is independently shippable and leaves the module in a working state.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Every count shows variance because non-recoverable waste was booked as stock | `is_recoverable` on `rw_materials` + `stock_effect = 'none'` dispositions, set correctly **before** Phase 1 goes live |
| Historical entries can't be reconciled, blocking go-live | Cutover date + opening count instead of a backfill |
| Counting burden on the floor | `count_frequency` per material — count high-value scrap weekly, sweepings monthly; sheet auto-fills only items with a non-zero balance |
| Variance blamed on rounding/unit mismatch | Ledger stores `unit` per movement; masters already have `rw_units`; a unit mismatch between entry and master should hard-fail at posting |
| Period lock frustrates legitimate late entries | Locks only after an **approved** count, and only for that location; a manager can reopen by cancelling the count, which is itself audited |
| Users edit posted entries | Reverse + repost, never in-place ledger mutation, so history stays reconstructable |

---

## 11. Decisions Needed Before Implementation

1. **Cutover date** — from which date should entries start producing stock? (Recommend the 1st of the month you go live.)
2. **Recoverable vs non-recoverable** — which materials leave physical residue that can actually be counted? This needs a walk-through of `rw_materials` with the floor team; it is the make-or-break input.
3. **Locations** — one scrap bin per department, or a single central scrap yard, or both (bin → yard transfer)? Rework bins: per department or per process?
4. **Count cadence and who counts** — daily/weekly/monthly per material class, and which role does the physical count vs the verification (segregation of duties needs two named people per location).
5. **Scrap sale ownership** — should scrap sales run through the R&W module (`rw_disposals`), or through the existing sales/dispatch flow with R&W only releasing the stock?
6. **Tolerance %** — a single company-wide default, or per material? (Schema supports per material with a default.)
7. **Rework return destination** — when rework completes, do the good pieces go back to WIP/production, into `floor_inventory`, or straight to finished goods? This determines whether Phase 1's rework-out is a simple OUT or a transfer to another module's stock.
8. **Existing R&W history** — leave as-is (recommended), or attempt a best-effort backfill for reporting continuity?
