# Rejection & Leakage Ball Inventory — Module Plan

Status: **Proposal / planning document** (no code changes yet).
Module: `rejections_wastages` (`rw_*` schema, `/rejections/*` routes).

---

## 1. The Process We Are Modelling

Tennis ball manufacturing, as the plant actually runs it (departments from
`production_departments`, in `sequence_order`):

```
Press ──► Jorr ──► Kapra Cutting / Kapra Pasting ──► Local Final / Fancy Final ──► Packing
(cups)   (two cups        (cloth covering)              (finishing)
          joined = core)
```

Two distinct defect events, both producing **saleable output**, not waste:

| Event | Where | What the ball is | Outcome |
|---|---|---|---|
| **Leakage — core** | Jorr (after joining two cups) | bare core, loses air | sold as a cheap ball |
| **Leakage — covered** | after cloth covering | covered ball, loses air | sold as a cheap ball |
| **Rejection** | finishing / inspection | black spots, seam-finish defects — **not reworkable** | sold as a cheap ball |

**How it is recorded today:** a checker on the floor counts leak balls and reject
balls **after each interval** and posts the number into the software.

**What is missing:** the posted number is the end of the story. The balls
physically travel to the store and are sold cheap, but nothing in the system
follows them there. So the checker's count cannot be checked against anything.

---

## 2. Why the First Draft of This Plan Was Wrong

The earlier version of this document treated rejection and wastage as **scrap
waste** — bins of residue, weighed in kg, disposed of by sale or destruction.
That framing does not fit this plant and has been replaced. The differences
matter to the design:

| Scrap framing (dropped) | Ball reality (this plan) |
|---|---|
| Residue with recovery value | **Finished/semi-finished goods**, downgraded but fully saleable |
| Measured in kg, lossy, needs a tolerance % | Measured in **pieces** — exactly countable, so **any** variance is a real event, not noise |
| Ends at a scrap yard, sold to a scrap buyer | Ends in the **store**, sold to normal customers as cheap balls |
| Risk = material leaving site unrecorded | Risk = **the checker's declared count not matching what reaches the store** |
| Needs `is_recoverable` flags (evaporation leaves nothing) | Every leaker and reject is a physical ball; there is no "non-recoverable" case |

The whole design therefore re-centres on the **floor → store handover**, which
is exactly where the user placed it: *"record in ledger and reconcile with store."*

---

## 3. Current State

### 3.1 The R&W module is a log with no inventory effect

| Table | Holds | Inventory effect |
|---|---|---|
| `rw_rejections` | date, dept, process, product, shift, `rejected_qty`, disposition, rework fields, reason, cost | **none** |
| `rw_leakages` | date, dept, process, material, shift, `leaked_qty`, reason, cost | **none** |
| `rw_wastages` | date, dept, material, shift, `wasted_qty`, reason, cost | **none** |
| `rw_dispositions` | `name`, `name_urdu` only | **carries no behaviour** |
| `rw_reasons` | `rejection` / `wastage` / `leakage` reasons | master only |
| `rw_materials` | `hp_material_id` → unit + `unit_cost` | master only |

Gaps specific to this process:

1. **No interval.** Entries carry `entry_date` + `shift` only. The checker counts
   per interval, so the natural grain is lost the moment it is typed in. A
   missed interval is invisible — and skipping an interval is the easiest way to
   hide balls.
2. **No checker.** `entered_by` is the app user who typed it, not the employee who
   physically counted. Accountability lands on the wrong person.
3. **`rw_leakages.material_id → hp_materials`** — leakage is keyed to a *material*.
   But a leaker is a **ball**, i.e. a `products` row. The leakage table cannot
   currently name what it actually is.
4. **No defect class.** "Leaker core", "leaker covered", "black spot", "seam" all
   collapse into a reason string. They are different physical items with different
   sale values.
5. **Nothing downstream.** No handover, no store receipt, no stock, no sale link.

### 3.2 Rejections are already captured twice

`production_entries` has `quantity_produced` / `quantity_ok` / `quantity_rejected`,
plus a `production_rejections` child table keyed to `defect_reasons` — all written
by `src/pages/production/DailyEntryPage.tsx`. So a rejection is entered **both** in
the production module and in the R&W module today, with no reconciliation between
them. **This must be resolved before Phase 1** (see decision #8).

### 3.3 What already exists that we should build on

- `production_entries` — `(date, shift, department, grade)` with produced / ok /
  rejected. This is the **denominator** for a defect-% plausibility check.
- `hourly_production_entries` — `(entry_date, hour_slot, process_name, worker_name, quantity)`.
  `hour_slot` is exactly the interval grain the checker works in, and
  `hourly_production_losses` shows the same `hour_slot` pattern reused for losses.
- `products` — has `grade_id` (LB / FB / KB / T / VM / V) and `uom_id`, and
  `inventory_stock.item_type = 'product'` — so a cheap ball can be a real,
  sellable SKU in the existing store.
- `standard_costs` — cost per dozen per (product, grade). Gives the value of what
  was lost when a good ball becomes a cheap one.
- `inventory_locations` / `inventory_stock` / `stock_movements` / `inventory_ledger`
  — the store-side four-table pattern to mirror.
- `consumption_grn_cutover()` — the dated-cutover precedent.
- `enforce_consumption_manual_entry_guard()` — the DB-level write-lock precedent.
- Role tiers `rejections_manager` / `rejections_officer` / `rejections_viewer`.

---

## 4. The Core Idea — a Five-Checkpoint Chain

A number is authenticated when it has to agree with something recorded by
**someone else**. So we build the ball's actual journey, and every arrow becomes
a measurable variance attributable to a named person:

```
①  Balls that passed the stage            production_entries / hourly_production_entries
          │   defect % must be plausible, and every interval must be accounted for
          ▼
②  Checker's interval count               rw_rejections / rw_leakages  (+ hour_slot, + checker)
          │   posts IN to the department's floor bin
          ▼
③  Floor bin balance                      rw_ball_ledger / rw_ball_stock
          │   handover note: floor sends, store counts — BLIND
          ▼
④  Store receipt                          rw_handovers  →  declared vs received  ◄── THE KEY CHECK
          │   periodic physical count of the cheap-ball store
          ▼
⑤  Cheap-ball sale                        existing sales / dispatch
```

Checkpoint ④ is what the user asked for. Checkpoints ① and ⑤ are what stop the
chain being gamed from either end — without ①, a checker can simply invent balls
that were never produced; without ⑤, balls can sit "in store" forever on paper.

---

## 5. Data Model

Conventions kept: `rw_` prefix, UUID PK, `created_at`/`updated_at` + the shared
`update_updated_at_column()` trigger, RLS with the module's existing policy shape.

### 5.1 `rw_defect_grades` — what class of cheap ball this is

The single most important new master. It replaces the inert `rw_dispositions` with
something that drives behaviour, value and routing.

```sql
CREATE TABLE rw_defect_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,            -- 'LEAK_CORE','LEAK_COVERED','REJ_SPOT','REJ_SEAM'
  name text NOT NULL,
  name_urdu text,
  defect_type text NOT NULL CHECK (defect_type IN ('leakage','rejection')),
  detected_stage text NOT NULL CHECK (detected_stage IN ('core','covered','finished')),
  department_id uuid REFERENCES production_departments(id),   -- where it is normally found
  onward_route text NOT NULL DEFAULT 'to_store'
    CHECK (onward_route IN ('to_store','continue_line','destroy')),
  output_product_id uuid REFERENCES products(id),   -- the cheap-ball SKU it becomes
  standard_cost numeric NOT NULL DEFAULT 0,         -- book value carried in the ledger
  default_sale_rate numeric NOT NULL DEFAULT 0,     -- expected cheap-ball realisation
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

`onward_route` settles the one genuinely ambiguous case: a **leaker core found at
Jorr**. Either it is pulled off the line straight away (`to_store`), or it carries
on and gets covered first, reaching the store only as a covered cheap ball
(`continue_line`). These produce completely different ledgers — the first holds
bare cores in stock, the second holds nothing at Jorr and only recognises stock
after covering. **Decision #1 below.**

`rw_reasons` is kept and stays orthogonal: the **reason** says *why* (bad seam
roller, operator error, compound batch); the **defect grade** says *what saleable
class resulted*. Both are recorded on every entry.

### 5.2 `rw_locations` — floor bins, transit, store

```sql
CREATE TABLE rw_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  name_urdu text,
  location_type text NOT NULL DEFAULT 'floor_bin'
    CHECK (location_type IN ('floor_bin','transit','store')),
  department_id uuid REFERENCES production_departments(id),
  inventory_location_id uuid REFERENCES inventory_locations(id),  -- bridge to the main store
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Typical rows: one `floor_bin` per counting department (Jorr, Local Final, Fancy
Final), one shared `transit`, one `store` ("Cheap Ball Store") carrying
`inventory_location_id` so Phase 4 can mirror into `inventory_stock`.

### 5.3 Additions to the existing entry tables

```sql
ALTER TABLE rw_leakages
  ADD COLUMN product_id uuid REFERENCES products(id),        -- a leaker is a BALL, not a material
  ADD COLUMN hour_slot integer,                              -- the checker's interval
  ADD COLUMN checked_by uuid REFERENCES employees(id),       -- who physically counted
  ADD COLUMN defect_grade_id uuid REFERENCES rw_defect_grades(id),
  ADD COLUMN location_id uuid REFERENCES rw_locations(id),
  ADD COLUMN posted boolean NOT NULL DEFAULT false,
  ADD COLUMN handover_id uuid REFERENCES rw_handovers(id);

-- same five additions on rw_rejections (which already has product_id)
```

One interval may be counted once and only once:

```sql
CREATE UNIQUE INDEX rw_leakages_interval_uk ON rw_leakages
  (entry_date, shift, hour_slot, department_id, product_id, defect_grade_id)
  WHERE hour_slot IS NOT NULL;
```

Re-submitting the same interval is a real and common failure — this makes it a
database error instead of a silent doubling of the day's leakage.

`rw_wastages` is left alone. Material wastage (compound, cloth off-cuts) is a
genuinely different thing from a defective ball and is out of scope here.

### 5.4 `rw_ball_ledger` — every movement, running balance

Item identity is **`(product_id, defect_grade_id)`** — an LB leaker and an FB
leaker are different stock, and a leaker core is different from a covered leaker.

```sql
CREATE TABLE rw_ball_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date date NOT NULL DEFAULT CURRENT_DATE,
  hour_slot integer,
  location_id uuid NOT NULL REFERENCES rw_locations(id),
  department_id uuid REFERENCES production_departments(id),
  product_id uuid NOT NULL REFERENCES products(id),
  defect_grade_id uuid NOT NULL REFERENCES rw_defect_grades(id),
  unit text NOT NULL DEFAULT 'pcs',

  quantity_in  numeric NOT NULL DEFAULT 0,
  quantity_out numeric NOT NULL DEFAULT 0,
  balance_quantity numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  value_in  numeric NOT NULL DEFAULT 0,
  value_out numeric NOT NULL DEFAULT 0,
  balance_value numeric NOT NULL,

  source_type text NOT NULL CHECK (source_type IN
    ('checker_entry','handover_out','handover_in','store_receipt',
     'count_adjustment','transfer','sale_issue','opening')),
  source_id uuid,
  reference_number text,
  remarks text,
  entered_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent posting. Location is part of the key because one handover writes
-- an OUT at the bin and an IN at transit.
CREATE UNIQUE INDEX rw_ball_ledger_source_uk ON rw_ball_ledger
  (source_type, source_id, location_id, product_id, defect_grade_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX rw_ball_ledger_item_idx ON rw_ball_ledger (product_id, defect_grade_id, txn_date);
CREATE INDEX rw_ball_ledger_loc_idx  ON rw_ball_ledger (location_id, txn_date);
```

### 5.5 `rw_ball_stock` — on-hand cache

```sql
CREATE TABLE rw_ball_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES rw_locations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  defect_grade_id uuid NOT NULL REFERENCES rw_defect_grades(id),
  unit text NOT NULL DEFAULT 'pcs',
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  stock_value numeric NOT NULL DEFAULT 0,
  last_movement_date timestamptz,
  last_counted_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, product_id, defect_grade_id)
);
```

Trigger-maintained from `rw_ball_ledger`; the ledger stays the source of truth
(same relationship as `inventory_ledger` ↔ `inventory_stock`).

### 5.6 `rw_handovers` + `rw_handover_items` — floor → store, the key control

```sql
CREATE TABLE rw_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_number text UNIQUE,                 -- 'RWH-YYYYMM-00001' (sequence + trigger)
  handover_date date NOT NULL DEFAULT CURRENT_DATE,
  shift text,
  department_id uuid REFERENCES production_departments(id),
  from_location_id uuid NOT NULL REFERENCES rw_locations(id),   -- floor bin
  to_location_id   uuid NOT NULL REFERENCES rw_locations(id),   -- store
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','received','disputed','cancelled')),
  sent_by uuid REFERENCES app_users(id),      sent_at timestamptz,
  received_by uuid REFERENCES app_users(id),  received_at timestamptz,
  total_sent_qty numeric NOT NULL DEFAULT 0,
  total_received_qty numeric NOT NULL DEFAULT 0,
  total_variance_qty numeric GENERATED ALWAYS AS
    (total_received_qty - total_sent_qty) STORED,
  variance_reason_id uuid REFERENCES rw_reasons(id),
  resolved_by uuid REFERENCES app_users(id),  resolved_at timestamptz,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rw_handover_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id uuid NOT NULL REFERENCES rw_handovers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  defect_grade_id uuid NOT NULL REFERENCES rw_defect_grades(id),
  unit text NOT NULL DEFAULT 'pcs',
  sent_quantity numeric NOT NULL DEFAULT 0,
  received_quantity numeric,                   -- NULL until the store counts
  variance_quantity numeric GENERATED ALWAYS AS
    (COALESCE(received_quantity, 0) - sent_quantity) STORED,
  unit_cost numeric NOT NULL DEFAULT 0,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (handover_id, product_id, defect_grade_id)
);
```

**Blind receipt is a hard requirement.** The storekeeper must not see
`sent_quantity` until `received_quantity` has been entered and saved. If the sent
figure is on screen, it gets copied and the entire reconciliation becomes
theatre. Enforced in the UI, and by `received_quantity` being `NOT NULL`-checked
only at the `sent → received` transition so it cannot be pre-filled.

Status flow and ledger effect:

| Transition | Ledger |
|---|---|
| `draft → sent` | OUT of floor bin, IN to transit (at `sent_quantity`) |
| `sent → received`, zero variance | OUT of transit, IN to store |
| `sent → received`, non-zero variance | OUT of transit at sent qty, IN to store at received qty, plus a `count_adjustment` row for the difference — **a `variance_reason_id` is mandatory** |
| `sent → disputed` | nothing posts; sits with the manager until resolved |

### 5.7 `rw_stock_counts` + `rw_stock_count_lines` — periodic store count

```sql
CREATE TABLE rw_stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_number text UNIQUE,                    -- 'RWC-YYYYMM-00001'
  count_date date NOT NULL DEFAULT CURRENT_DATE,
  location_id uuid NOT NULL REFERENCES rw_locations(id),
  count_type text NOT NULL DEFAULT 'periodic'
    CHECK (count_type IN ('daily','weekly','monthly','spot','periodic')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','posted','cancelled')),
  counted_by  uuid REFERENCES app_users(id),
  verified_by uuid REFERENCES app_users(id),   -- must differ from counted_by
  approved_by uuid REFERENCES app_users(id),   approved_at timestamptz,
  total_variance_qty numeric NOT NULL DEFAULT 0,
  total_variance_value numeric NOT NULL DEFAULT 0,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, count_date, count_type)
);

CREATE TABLE rw_stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES rw_stock_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  defect_grade_id uuid NOT NULL REFERENCES rw_defect_grades(id),
  unit text NOT NULL DEFAULT 'pcs',
  system_quantity   numeric NOT NULL DEFAULT 0,   -- FROZEN at sheet creation
  physical_quantity numeric NOT NULL DEFAULT 0,
  variance_quantity numeric GENERATED ALWAYS AS
    (physical_quantity - system_quantity) STORED,
  unit_cost numeric NOT NULL DEFAULT 0,
  variance_value numeric GENERATED ALWAYS AS
    ((physical_quantity - system_quantity) * unit_cost) STORED,
  variance_reason_id uuid REFERENCES rw_reasons(id),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_id, product_id, defect_grade_id)
);
```

`system_quantity` is **frozen at sheet creation**, never re-read at approval. If
it were live, a back-dated entry would silently erase the variance — destroying
the one signal this whole feature exists to produce. Generated variance columns
follow `consumption_stock_closing.actual_consumption`, already a stored generated
column in this schema.

**Because balls are counted in pieces, the variance tolerance is zero.** There is
no shrinkage, evaporation or weighing error to absorb. Any non-zero variance
demands a reason and a manager approval.

---

## 6. Posting Rules

One shared `rw_post_ball_movement()` function, called from `AFTER` triggers.

| Event | Movement |
|---|---|
| Checker entry saved, defect grade `onward_route = 'to_store'` | **IN** to the department's floor bin, `source_type = 'checker_entry'` |
| Checker entry saved, `onward_route = 'continue_line'` | **no stock** — the ball stays on the line and is recognised at the later stage instead (recorded for defect-% reporting only) |
| Checker entry saved, `onward_route = 'destroy'` | **IN** then immediate **OUT**, so the count is still reportable but no stock is held |
| Handover `sent` | **OUT** floor bin → **IN** transit |
| Handover `received` | **OUT** transit → **IN** store (+ variance adjustment row) |
| Store count approved | **IN/OUT** the variance, `source_type = 'count_adjustment'` |
| Cheap-ball sale (Phase 4) | **OUT** store, `source_type = 'sale_issue'` |
| Entry edited | reverse + repost — never mutate a ledger row in place |
| Entry deleted | reverse only; refused if the entry is already on a `received` handover |

**Cutover.** Following `consumption_grn_cutover()`, an `rw_ball_cutover()` function
returns one configurable date. Entries before it stay as pure log rows; entries
on/after it post to the ledger. Opening balances come from one physical count per
location dated on the cutover (`source_type = 'opening'`) — not from a fabricated
backfill of history nobody can verify.

---

## 7. Integrity Controls

1. **Every interval must be accounted for.** A view compares hour slots that have
   production against hour slots that have a checker entry. A missing interval is
   flagged the same day. *Silence is the cheapest way to hide balls; this closes it.*
2. **Defect % plausibility.** Leak + reject counts for a `(date, shift, department,
   grade)` are divided by `production_entries.quantity_produced` for the same key.
   Outside a configured band → flagged for review before it is ever handed over.
3. **Blind receipt** at the store (§5.6).
4. **Zero-tolerance variance** with a mandatory reason and manager approval.
5. **No negative balances.** A handover cannot send more than the bin holds; the
   posting function raises. This alone catches sending more cheap balls to the
   store than were ever declared.
6. **Segregation of duties.** `counted_by ≠ verified_by ≠ approved_by` on counts;
   `sent_by ≠ received_by` on handovers.
7. **Locking.** Once a handover is `received`, its source entries are read-only.
   Once a store count is approved, entries and handovers dated on or before it
   lock for that location. Trigger-enforced, same shape as
   `enforce_consumption_manual_entry_guard`; `super_admin` bypass only, logged.
8. **Checker accuracy scoring.** Per checker per month: declared vs received at
   store, plus flagged intervals. A checker whose counts never survive the
   handover becomes visible without anyone running an audit.

---

## 8. Reporting Views

| View | Answers |
|---|---|
| `v_rw_interval_coverage` | Which intervals had production but no checker entry? |
| `v_rw_defect_vs_production` | Leak % and reject % per date/shift/department/grade vs produced qty, with the out-of-band flag |
| `v_rw_handover_variance` | Declared vs received per handover, department, checker, storekeeper |
| `v_rw_store_reconciliation` | Opening + receipts − sales = book vs physical count, per item per period |
| `v_rw_checker_accuracy` | Per checker: declared, received, variance, accuracy % |
| `v_rw_cost_of_quality` | Standard cost of the good ball (`standard_costs`) − cheap-ball realisation = loss, per period/department |

---

## 9. UI

New pages under `/rejections`, wired into `App.tsx` and the `rejections_wastages`
group in `ERPSidebar.tsx`, following existing page structure (`ERPLayout` +
`PageHeader` + shadcn `Card`/`Table`, `useQuery` against Supabase).

| Route | Page | Notes |
|---|---|---|
| `/rejections/checker` | **Checker Interval Entry** | Replaces the current entry form for balls. Pick department + shift + interval; a compact grid of product × defect grade with number inputs. Mobile-first, large tap targets, one save per interval. Shows the interval's produced qty and live defect % as it is typed. |
| `/rejections/bin` | **Floor Bin Stock** | Current bin balance per department, per product/defect grade, with age |
| `/rejections/handovers` | **Handovers** | Floor creates and sends; store opens and enters a **blind** count; variance shown only after saving; dispute path to manager; printable handover slip |
| `/rejections/store` | **Cheap Ball Store Stock** | Store balances, last counted date, value |
| `/rejections/ledger` | **Ball Ledger** | Every movement with running balance, filters, drill-through to source |
| `/rejections/counts` | **Store Physical Count** | Frozen book snapshot, physical entry, variance, verify → approve → adjust |
| `/rejections/reconciliation` | **Reconciliation Dashboard** | The five checkpoints on one screen: interval coverage, defect-% flags, handover variance, store variance, checker accuracy |
| `/rejections/defect-grades` | **Defect Grades Master** | super admin |
| `/rejections/locations` | **Locations Master** | super admin |

Existing pages change as follows:
- `RejectionsWastageEntryPage` — keeps material wastage; ball leakage/rejection moves to the new checker screen.
- `ReworkTrackingPage` — these defects are explicitly *not* reworkable, so this page becomes irrelevant for balls and stays only for any rework-disposition rejections that remain.
- `RejectionsAnalyticsPage` — gains defect-% trend by department/interval and the cost-of-quality figure.

---

## 10. Roles

No new enum values needed — the tiers from `20260829120000_add_module_roles_all_modules.sql` cover it:

- `rejections_officer` — checker entry, create and send handovers, count.
- `rejections_manager` — receive at store, approve variances, resolve disputes, approve counts.
- `rejections_viewer` — read-only.
- `super_admin` — deletes, lock bypass, masters.

The one nuance is that the person receiving at store must differ from the person who sent — enforced per document (§7.6), not by a new role.

---

## 11. Phasing

**Phase 1 — Capture the count properly**
`rw_defect_grades`, `rw_locations`, the entry-table additions (`hour_slot`,
`checked_by`, `product_id` on leakages, `defect_grade_id`, `location_id`) with the
per-interval unique index, `rw_ball_ledger` + `rw_ball_stock` and the posting
trigger, `rw_ball_cutover()`, the Checker Interval Entry screen, Floor Bin Stock,
Ball Ledger, plus `v_rw_interval_coverage` and `v_rw_defect_vs_production`.
*Deliverable: every interval count lands in a ledger with a running bin balance, and missing intervals or implausible defect rates surface the same day.*

**Phase 2 — Floor → store handover** *(the reconciliation asked for)*
`rw_handovers` / `rw_handover_items`, blind receipt, variance with mandatory
reason, dispute path, Store Stock page, handover-variance and checker-accuracy
views, locking on receipt.
*Deliverable: declared vs received is measured on every handover and attributed to named people.*

**Phase 3 — Store count and period close**
`rw_stock_counts` / `rw_stock_count_lines`, frozen snapshot, verify/approve,
adjustment posting, period lock, Reconciliation Dashboard.
*Deliverable: store book equals physical, and back-dating is blocked.*

**Phase 4 — Sales and cost of quality**
Mirror store stock into `inventory_stock` against cheap-ball SKUs so the existing
sales/dispatch flow consumes it; `v_rw_cost_of_quality` against `standard_costs`;
optional GL posting.
*Deliverable: cheap balls sell out of the same stock they were received into, and the money lost to defects is a reported number.*

Each phase ships independently and leaves the module working.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Checker screen too slow, so counts get batched at shift end and the interval grain is fake | Phase 1 UI is a single mobile grid, one save per interval; `v_rw_interval_coverage` shows batching as late/missing intervals |
| Storekeeper copies the sent figure | Blind receipt, enforced in UI and by the transition rule |
| Double capture vs `production_entries.quantity_rejected` | Resolved as decision #8 **before** Phase 1 — one source of truth, the other becomes derived or read-only |
| Leaker cores at Jorr counted, then counted again as covered leakers after covering | `onward_route = 'continue_line'` records the Jorr count for reporting but posts no stock, so the ball is only ever stocked once |
| Per-product counting is too fine-grained for the floor | Decision #5 — if the checker realistically counts only a total per interval, the ledger key drops `product_id` and holds `(department, defect_grade)` instead. Cheaper to decide now than to migrate later. |
| Cutover disputes over historical entries | Dated cutover + opening count, no fabricated backfill |

---

## 13. Decisions Needed Before Implementation

1. **Leaker core at Jorr — pulled out or covered first?** Sold as a bare leaking
   core, or does it continue down the line, get covered, and only then get sold as
   a cheap ball? This sets `onward_route` and determines whether Jorr holds stock
   at all. *Biggest single question.*
2. **Interval definition.** Hourly (matching `hourly_production_entries.hour_slot`),
   or a different fixed interval? How many per shift, and do Day and Night differ?
3. **Does the checker count by product/model** (LB, FB, KB, T, VM, V), or just a
   total ball count per interval? Decides whether the ledger is keyed per product
   or per department only (see risk above).
4. **Where do cheap balls physically sit** between the checker's count and the
   store — a bin at the department, or carried immediately? And is the destination
   the existing "Store department", or a separate cheap-ball store?
5. **Do cheap-ball SKUs exist in `products` today,** or are cheap balls sold
   without a product record? Phase 4 needs a real SKU per (model, defect class).
6. **Handover frequency** — per interval, per shift, or once a day? This sets how
   tight the reconciliation loop is.
7. **Who receives at the store,** and is that person distinct from the checker and
   from whoever sends? Blind receipt needs two real people.
8. **`production_entries.quantity_rejected` vs `rw_rejections`** — rejections are
   entered in both places today. Which is the source of truth? Recommended: the
   R&W checker entry becomes authoritative and the production figure is derived
   from it, so the two can never disagree. Needs confirmation.
9. **Cutover date** — from which date do entries start producing stock?
   (Recommend the 1st of the month you go live.)
10. **Material wastage** (`rw_wastages` — compound, cloth off-cuts) — leave as a
    pure log for now, or bring it into a separate scrap inventory later? This plan
    deliberately covers balls only.
