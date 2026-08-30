# Rejection & Leakage Ball Inventory — Module Plan

Status: **Proposal / planning document** (no code changes yet).
Module: `rejections_wastages` (`rw_*` schema, `/rejections/*` routes).

Confirmed with the plant: leaker cores at Jorr are **covered first, then sold**;
counting is **per ball model**; handover to store is **daily**.

---

## 1. The Process We Are Modelling

Tennis ball manufacturing, as the plant runs it (departments from
`production_departments`, in `sequence_order`):

```
Press ──► Jorr ──► Kapra Cutting / Pasting ──► Local Final / Fancy Final ──► Packing
(cups)   (two cups        (cloth covering)            (finishing)
          joined = core)
```

Three defect events, all producing **saleable output**, not waste:

| Event | Where | Physical state | Route |
|---|---|---|---|
| **Leakage — core** | Jorr, after joining two cups | bare core, loses air | **covered first**, then sold cheap |
| **Leakage — covered** | after cloth covering | covered ball, loses air | sold cheap |
| **Rejection** | finishing / inspection | black spots, seam-finish defects, **not reworkable** | sold cheap |

**How it is recorded today:** a checker counts leak balls and reject balls after
each interval and posts the number into the software. That number is the end of
the story — nothing follows the balls to the store, so the count cannot be
checked against anything.

**Value depends on the model.** A leaker in a cheap grade sells for less than a
leaker in a high grade, so quantity alone is not enough — every count, every
ledger row and every handover line is keyed by **ball model**.

---

## 2. Current State

### 2.1 The R&W module is a log with no inventory effect

| Table | Holds | Inventory effect |
|---|---|---|
| `rw_rejections` | date, dept, process, product, shift, `rejected_qty`, disposition, rework fields, reason, cost | **none** |
| `rw_leakages` | date, dept, process, material, shift, `leaked_qty`, reason, cost | **none** |
| `rw_wastages` | date, dept, material, shift, `wasted_qty`, reason, cost | **none** |
| `rw_dispositions` | `name`, `name_urdu` only | **carries no behaviour** |
| `rw_reasons` | `rejection` / `wastage` / `leakage` reasons | master only |

Gaps specific to this process:

1. **No interval.** Entries carry `entry_date` + `shift` only, so the checker's
   interval grain is lost the moment it is typed in. A skipped interval is
   invisible — and skipping one is the cheapest way to hide balls.
2. **No checker.** `entered_by` is the app user who typed it, not the employee who
   physically counted. Accountability lands on the wrong person.
3. **`rw_leakages.material_id → hp_materials`.** A leaker is a **ball**, i.e. a
   `products` row. The leakage table cannot currently name what it actually is —
   which also means it cannot distinguish a cheap-grade leaker from a high-grade
   one, the exact distinction that drives its value.
4. **No defect class.** "Leaker core", "leaker covered", "black spot" and "seam"
   collapse into a reason string, though they are different items with different
   values and different onward routes.
5. **Nothing downstream.** No handover, no store receipt, no stock, no sale link.

### 2.2 Rejections are already captured twice

`production_entries` carries `quantity_produced` / `quantity_ok` /
`quantity_rejected`, plus a `production_rejections` child table keyed to
`defect_reasons` — all written by `src/pages/production/DailyEntryPage.tsx`. A
rejection is therefore entered **both** in the production module and in R&W
today, with nothing reconciling them. **Must be resolved before Phase 1**
(decision A below).

### 2.3 What already exists that we build on

- `production_entries` — `(date, shift, department, grade)` with produced / ok /
  rejected: the **denominator** for a defect-% plausibility check.
- `hourly_production_entries` — `(entry_date, hour_slot, process_name, worker_name,
  quantity)`. `hour_slot` is exactly the checker's interval grain, and
  `hourly_production_losses` reuses the same pattern.
- `products` — has `grade_id` (LB / FB / KB / T / VM / V) and `uom_id`;
  `inventory_stock.item_type = 'product'`, so a cheap ball can be a real sellable
  SKU in the existing store.
- `standard_costs` — `(product_id, grade_id, cost_per_dozen)` with a
  `COALESCE(grade_id, …)` unique index. The pattern to mirror for cheap-ball rates.
- `inventory_locations` / `inventory_stock` / `stock_movements` / `inventory_ledger`
  — the store-side four-table shape.
- `consumption_grn_cutover()` — the dated-cutover precedent.
- `enforce_consumption_manual_entry_guard()` — the DB-level write-lock precedent.
- Role tiers `rejections_manager` / `rejections_officer` / `rejections_viewer`.

---

## 3. The Ball's Journey — and why the Jorr answer reshapes it

Because a leaker core is **covered before it is sold**, it does not become
cheap-ball stock at Jorr. It becomes a **tracked work-in-progress stream**: a
segregated batch of known-bad cores that must survive the covering step and
come out the other side as covered cheap balls.

That gives us one more checkpoint than the earlier draft had, and a free one —
Jorr declares cores in, covering declares covered balls out:

```
①  Balls that passed the stage         production_entries / hourly_production_entries
          │  defect % plausible?  every interval accounted for?
          ▼
②  Jorr checker counts leaker cores    → IN to the Jorr leaker bin   (WIP, not sellable yet)
          │  covering transfer: cores out, covered cheap balls in     ◄── CHECK 1
          ▼
③  Final checker counts NEW covered    → IN to the Final cheap-ball bin
    leakers + rejects
          │  daily handover: declared → sent → received (BLIND)       ◄── CHECK 2
          ▼
④  Cheap-ball store                    rw_ball_stock @ store location
          │  periodic physical count                                  ◄── CHECK 3
          ▼
⑤  Cheap-ball sale                     existing sales / dispatch
```

Every arrow is a variance attributable to a named person.

### The one thing this design depends on

**Segregation.** A leaker core identified at Jorr is put in a marked bin, covered
as an identified batch, and goes to the cheap-ball store as a covered leaker. It
must **not** rejoin the good stream and be re-counted by the Final checker as a
new leaker — that would book the same ball twice: once as `LEAK_CORE` at Jorr and
again as `LEAK_COVERED` at Final.

The design enforces this structurally: the covering transfer produces the covered
cheap balls directly, so the Final checker's screen is for **new** leakers only.
Worth confirming the floor genuinely works this way (decision B) — if the
segregated batch is in practice air-tested again at Final, the Jorr count becomes
informational and only the Final count creates stock, which is a smaller design.

---

## 4. Data Model

Conventions kept: `rw_` prefix, UUID PK, `created_at`/`updated_at` + the shared
`update_updated_at_column()` trigger, RLS with the module's existing policy shape.

### 4.1 `rw_defect_grades` — the class of cheap ball

Replaces the inert `rw_dispositions` with a master that drives routing and value.

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
    CHECK (onward_route IN ('to_store','cover_then_store','destroy')),
  covered_output_grade_id uuid REFERENCES rw_defect_grades(id),  -- what it becomes after covering
  is_sellable boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rw_defect_grades_cover_route_needs_output
    CHECK (onward_route <> 'cover_then_store' OR covered_output_grade_id IS NOT NULL)
);
```

Seed shape:

| code | type | stage | onward_route | covered_output |
|---|---|---|---|---|
| `LEAK_CORE` | leakage | core | `cover_then_store` | → `LEAK_COVERED` |
| `LEAK_COVERED` | leakage | covered | `to_store` | — |
| `REJ_SPOT` | rejection | finished | `to_store` | — |
| `REJ_SEAM` | rejection | finished | `to_store` | — |

`rw_reasons` stays and is orthogonal: the **reason** says *why* (bad seam roller,
operator error, compound batch); the **defect grade** says *what saleable class
resulted*. Both are recorded on every entry.

### 4.2 `rw_defect_rates` — value per model × defect grade

Because a cheap-grade leaker is worth less than a high-grade leaker, cost and
sale rate cannot live on the defect grade alone. This mirrors `standard_costs`,
including its `COALESCE` unique-index trick for the optional dimension.

```sql
CREATE TABLE rw_defect_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,   -- NULL = default for the defect grade
  defect_grade_id uuid NOT NULL REFERENCES rw_defect_grades(id) ON DELETE CASCADE,
  standard_cost numeric NOT NULL DEFAULT 0,   -- book value carried into the ledger
  sale_rate numeric NOT NULL DEFAULT 0,       -- expected cheap-ball realisation
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES app_users(id),
  updated_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX rw_defect_rates_uniq ON rw_defect_rates
  (defect_grade_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid));
```

Resolution: exact `(product, defect_grade)` wins; otherwise the `product_id IS NULL`
row for that defect grade; otherwise zero. Same "specific beats general" rule as
`consumption_product_for_production`.

### 4.3 `rw_locations` — bins, transit, store

```sql
CREATE TABLE rw_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  name_urdu text,
  location_type text NOT NULL DEFAULT 'floor_bin'
    CHECK (location_type IN ('floor_bin','leaker_wip','transit','store')),
  department_id uuid REFERENCES production_departments(id),
  inventory_location_id uuid REFERENCES inventory_locations(id),  -- bridge to the main store
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Typical rows: `leaker_wip` at Jorr (leaker cores awaiting covering), `floor_bin`
at Local Final and Fancy Final (covered leakers + rejects awaiting the daily
handover), one shared `transit`, and one `store` ("Cheap Ball Store") carrying
`inventory_location_id` so Phase 4 can mirror into `inventory_stock`.

### 4.4 Additions to the existing entry tables

```sql
ALTER TABLE rw_leakages
  ADD COLUMN product_id uuid REFERENCES products(id),        -- a leaker is a BALL, not a material
  ADD COLUMN hour_slot integer,                              -- the checker's interval
  ADD COLUMN checked_by uuid REFERENCES employees(id),       -- who physically counted
  ADD COLUMN defect_grade_id uuid REFERENCES rw_defect_grades(id),
  ADD COLUMN location_id uuid REFERENCES rw_locations(id),
  ADD COLUMN posted boolean NOT NULL DEFAULT false,
  ADD COLUMN handover_id uuid REFERENCES rw_handovers(id);

-- the same six additions on rw_rejections (which already has product_id)
```

One interval, one model, one defect grade, counted once:

```sql
CREATE UNIQUE INDEX rw_leakages_interval_uk ON rw_leakages
  (entry_date, shift, hour_slot, department_id, product_id, defect_grade_id)
  WHERE hour_slot IS NOT NULL;
```

Re-submitting an interval is a common, real failure — this makes it a database
error instead of a silent doubling of the day's leakage.

`rw_wastages` is left alone: material wastage (compound, cloth off-cuts) is a
genuinely different problem and is out of scope here.

### 4.5 `rw_ball_ledger` — every movement, running balance

Item identity is **`(product_id, defect_grade_id)`** — an LB leaker and an FB
leaker are different stock at different values, and a leaker core is different
from a covered leaker.

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
    ('checker_entry','cover_out','cover_in','handover_out','handover_in',
     'store_receipt','count_adjustment','sale_issue','opening')),
  source_id uuid,
  reference_number text,
  remarks text,
  entered_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent posting. Location and item are part of the key because one document
-- writes an OUT at one location and an IN at another.
CREATE UNIQUE INDEX rw_ball_ledger_source_uk ON rw_ball_ledger
  (source_type, source_id, location_id, product_id, defect_grade_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX rw_ball_ledger_item_idx ON rw_ball_ledger (product_id, defect_grade_id, txn_date);
CREATE INDEX rw_ball_ledger_loc_idx  ON rw_ball_ledger (location_id, txn_date);
```

### 4.6 `rw_ball_stock` — on-hand cache

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
(the `inventory_ledger` ↔ `inventory_stock` relationship).

### 4.7 `rw_cover_transfers` + `rw_cover_transfer_items` — leaker cores through covering

The step that answer 1 creates. Leaker cores leave the Jorr bin; covered cheap
balls arrive in the Final bin. It is a **transformation**: the same physical ball
changes defect grade from `LEAK_CORE` to `LEAK_COVERED`.

```sql
CREATE TABLE rw_cover_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number text UNIQUE,                 -- 'RWC-YYYYMM-00001'
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  from_location_id uuid NOT NULL REFERENCES rw_locations(id),   -- Jorr leaker bin
  to_location_id   uuid NOT NULL REFERENCES rw_locations(id),   -- Final cheap-ball bin
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','completed','disputed','cancelled')),
  issued_by uuid REFERENCES app_users(id),     issued_at timestamptz,
  received_by uuid REFERENCES app_users(id),   received_at timestamptz,
  total_issued_qty numeric NOT NULL DEFAULT 0,
  total_covered_qty numeric NOT NULL DEFAULT 0,
  total_variance_qty numeric GENERATED ALWAYS AS
    (total_covered_qty - total_issued_qty) STORED,
  variance_reason_id uuid REFERENCES rw_reasons(id),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rw_cover_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES rw_cover_transfers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  from_defect_grade_id uuid NOT NULL REFERENCES rw_defect_grades(id),   -- LEAK_CORE
  to_defect_grade_id   uuid NOT NULL REFERENCES rw_defect_grades(id),   -- LEAK_COVERED
  issued_quantity numeric NOT NULL DEFAULT 0,
  covered_quantity numeric,                    -- NULL until covering reports back
  variance_quantity numeric GENERATED ALWAYS AS
    (COALESCE(covered_quantity, 0) - issued_quantity) STORED,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, product_id, from_defect_grade_id)
);
```

The model is carried through unchanged — an LB leaker core becomes an LB covered
leaker, never an FB one. `to_defect_grade_id` defaults from
`rw_defect_grades.covered_output_grade_id`.

Any variance here is real: cores issued to covering that never came out. Nothing
in the current system would show that at all.

### 4.8 `rw_handovers` + `rw_handover_items` — the daily floor → store handover

Handover is **daily**, so exactly one per (date, source bin):

```sql
CREATE TABLE rw_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_number text UNIQUE,                 -- 'RWH-YYYYMM-00001'
  handover_date date NOT NULL DEFAULT CURRENT_DATE,
  department_id uuid REFERENCES production_departments(id),
  from_location_id uuid NOT NULL REFERENCES rw_locations(id),   -- floor bin
  to_location_id   uuid NOT NULL REFERENCES rw_locations(id),   -- store
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','received','disputed','cancelled')),
  sent_by uuid REFERENCES app_users(id),      sent_at timestamptz,
  received_by uuid REFERENCES app_users(id),  received_at timestamptz,
  total_declared_qty numeric NOT NULL DEFAULT 0,
  total_sent_qty numeric NOT NULL DEFAULT 0,
  total_received_qty numeric NOT NULL DEFAULT 0,
  floor_variance_qty numeric GENERATED ALWAYS AS
    (total_sent_qty - total_declared_qty) STORED,      -- declared by checkers vs actually sent
  transit_variance_qty numeric GENERATED ALWAYS AS
    (total_received_qty - total_sent_qty) STORED,      -- sent vs received at store
  floor_variance_reason_id uuid REFERENCES rw_reasons(id),
  transit_variance_reason_id uuid REFERENCES rw_reasons(id),
  resolved_by uuid REFERENCES app_users(id),  resolved_at timestamptz,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (handover_date, from_location_id)     -- one handover per bin per day
);

CREATE TABLE rw_handover_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id uuid NOT NULL REFERENCES rw_handovers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  defect_grade_id uuid NOT NULL REFERENCES rw_defect_grades(id),
  unit text NOT NULL DEFAULT 'pcs',
  declared_quantity numeric NOT NULL DEFAULT 0,   -- auto-summed from the day's checker entries, read-only
  sent_quantity numeric NOT NULL DEFAULT 0,       -- what the floor physically hands over
  received_quantity numeric,                      -- NULL until the store counts
  floor_variance_quantity numeric GENERATED ALWAYS AS
    (sent_quantity - declared_quantity) STORED,
  transit_variance_quantity numeric GENERATED ALWAYS AS
    (COALESCE(received_quantity, 0) - sent_quantity) STORED,
  unit_cost numeric NOT NULL DEFAULT 0,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (handover_id, product_id, defect_grade_id)
);
```

**Three quantities, two variances** — this is what daily handover buys us, and it
separates two very different failures:

- **declared vs sent** — the checkers booked 500 for the day but only 480 left the
  floor. Balls held back, or a count that was never real.
- **sent vs received** — 480 left, 470 arrived. Lost in transit, or miscounted at
  one end.

Collapsing them into one number would leave you unable to tell which department
to talk to.

**Blind receipt is a hard requirement.** The storekeeper must not see
`declared_quantity` or `sent_quantity` until `received_quantity` is entered and
saved. If the sent figure is on screen it gets copied, and the reconciliation
becomes theatre.

**The bin must empty.** With one handover per bin per day, the bin balance should
return to zero after receipt. A non-zero carry-over is itself a flag, shown on
the dashboard — no extra data needed to detect it.

### 4.9 `rw_stock_counts` + `rw_stock_count_lines` — periodic store count

```sql
CREATE TABLE rw_stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_number text UNIQUE,                    -- 'RWN-YYYYMM-00001'
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
the one signal this feature exists to produce. Generated variance columns follow
`consumption_stock_closing.actual_consumption`, already a stored generated column
in this schema.

**Balls are counted in pieces, so the variance tolerance is zero.** There is no
shrinkage or weighing error to absorb. Any non-zero variance demands a reason and
a manager approval.

---

## 5. Posting Rules

One shared `rw_post_ball_movement()` function, called from `AFTER` triggers.
`unit_cost` resolves through `rw_defect_rates` at posting time and is stored on
the ledger row, so later rate changes never rewrite history.

| Event | Ledger effect |
|---|---|
| Checker entry, `onward_route = 'to_store'` (covered leakers, rejects) | **IN** to the department floor bin, `checker_entry` |
| Checker entry, `onward_route = 'cover_then_store'` (Jorr leaker cores) | **IN** to the Jorr `leaker_wip` bin, `checker_entry` — held as WIP, not sellable |
| Checker entry, `onward_route = 'destroy'` | **IN** then immediate **OUT**, so the count reports but no stock is held |
| Cover transfer `issued` | **OUT** Jorr bin at `issued_quantity` (`cover_out`) |
| Cover transfer `completed` | **IN** Final bin at `covered_quantity` as the **`to_defect_grade_id`** (`cover_in`); shortfall stays visible as the transfer's variance |
| Handover `sent` | **OUT** floor bin → **IN** transit, at `sent_quantity` |
| Handover `received` | **OUT** transit → **IN** store at `received_quantity`; the difference posts as `count_adjustment` with a **mandatory reason** |
| Handover `disputed` | nothing posts; sits with the manager until resolved |
| Store count approved | **IN/OUT** the variance, `count_adjustment` |
| Cheap-ball sale (Phase 4) | **OUT** store, `sale_issue` |
| Entry edited | reverse + repost — never mutate a ledger row in place |
| Entry deleted | reverse only; refused once the entry sits on an issued transfer or a received handover |

**Cutover.** Following `consumption_grn_cutover()`, an `rw_ball_cutover()` function
returns one configurable date. Entries before it stay pure log rows; entries on or
after it post to the ledger. Opening balances come from one physical count per
location dated on the cutover (`source_type = 'opening'`) — not from a fabricated
backfill nobody can verify.

---

## 6. Integrity Controls

1. **Every interval must be accounted for.** A view compares hour slots with
   production against hour slots with a checker entry. A missing interval is
   flagged the same day — silence is the cheapest way to hide balls.
2. **Defect % plausibility.** Leak and reject counts per `(date, shift, department,
   model)` divided by `production_entries.quantity_produced` for the same key.
   Outside a configured band → flagged before handover.
3. **The Jorr bin must drain.** Leaker cores in must equal cores issued to
   covering. A growing `leaker_wip` balance means cores are being counted but
   never covered — or never existed.
4. **Cover transfer variance.** Cores issued vs covered balls returned.
5. **Blind receipt** at the store (§4.8).
6. **Two separate handover variances** (declared→sent, sent→received), each with
   its own mandatory reason, so the failure is attributable.
7. **The floor bin must empty daily.** Non-zero carry-over after a received
   handover is flagged.
8. **Zero-tolerance store variance** with mandatory reason and manager approval.
9. **No negative balances.** A transfer or handover cannot move more than the bin
   holds; the posting function raises.
10. **Segregation of duties.** `sent_by ≠ received_by` on handovers and transfers;
    `counted_by ≠ verified_by ≠ approved_by` on counts.
11. **Locking.** Once a handover is `received`, its source entries are read-only.
    Once a store count is approved, entries, transfers and handovers dated on or
    before it lock for that location. Trigger-enforced, same shape as
    `enforce_consumption_manual_entry_guard`; `super_admin` bypass only, logged.
12. **Checker accuracy scoring.** Per checker per month: declared vs sent vs
    received, plus flagged intervals. A checker whose counts never survive the
    handover becomes visible without anyone running an audit.

---

## 7. Reporting Views

| View | Answers |
|---|---|
| `v_rw_interval_coverage` | Which intervals had production but no checker entry? |
| `v_rw_defect_vs_production` | Leak % and reject % per date/shift/department/model vs produced qty, with the out-of-band flag |
| `v_rw_leaker_wip` | Jorr leaker cores: counted, issued to covering, still waiting, aged |
| `v_rw_cover_variance` | Cores issued vs covered balls returned, per transfer and per period |
| `v_rw_handover_variance` | Declared vs sent vs received per day, department, checker, storekeeper |
| `v_rw_store_reconciliation` | Opening + receipts − sales = book vs physical, per model × defect grade per period |
| `v_rw_checker_accuracy` | Per checker: declared, sent, received, variance, accuracy % |
| `v_rw_cost_of_quality` | `standard_costs` value of the good ball − cheap-ball realisation, per period/department/model |

---

## 8. UI

New pages under `/rejections`, wired into `App.tsx` and the `rejections_wastages`
group in `ERPSidebar.tsx`, following existing page structure (`ERPLayout` +
`PageHeader` + shadcn `Card`/`Table`, `useQuery` against Supabase).

| Route | Page | Notes |
|---|---|---|
| `/rejections/checker` | **Checker Interval Entry** | Department + shift + interval, then a compact grid of **model × defect grade** with number inputs. Models default to those actually in production for that department/shift (from `production_entries`), with an "add another model" escape — so the grid stays two or three rows, not thirty. Mobile-first, large tap targets, one save per interval, live defect % against the interval's produced qty. |
| `/rejections/leaker-wip` | **Leaker Cores (Jorr)** | Bin balance by model, ageing, and the "issue to covering" action |
| `/rejections/cover-transfers` | **Cover Transfers** | Issue cores → covering reports covered qty → variance |
| `/rejections/handovers` | **Daily Handover** | Auto-filled declared column from the day's entries; floor enters sent; store enters a **blind** received count; both variances shown only after saving; dispute path; printable slip |
| `/rejections/store` | **Cheap Ball Store Stock** | Balances by model × defect grade, value, last counted |
| `/rejections/ledger` | **Ball Ledger** | Every movement with running balance, filters, drill-through to source |
| `/rejections/counts` | **Store Physical Count** | Frozen book snapshot, physical entry, variance, verify → approve → adjust |
| `/rejections/reconciliation` | **Reconciliation Dashboard** | Interval coverage, defect-% flags, leaker-WIP ageing, cover variance, handover variances, bin-not-empty flags, store variance, checker accuracy |
| `/rejections/defect-grades` | **Defect Grades Master** | super admin |
| `/rejections/defect-rates` | **Cheap Ball Rates** | cost + sale rate per model × defect grade; manager |
| `/rejections/locations` | **Locations Master** | super admin |

Existing pages change as follows:
- `RejectionsWastageEntryPage` — keeps material wastage; ball leakage and rejection move to the new checker screen.
- `ReworkTrackingPage` — these defects are explicitly not reworkable, so it stays only for any rework-disposition rejections that remain.
- `RejectionsAnalyticsPage` — gains defect-% trend by department/interval/model and the cost-of-quality figure.

---

## 9. Roles

No new enum values needed — the tiers from
`20260829120000_add_module_roles_all_modules.sql` cover it:

- `rejections_officer` — checker entry, issue cover transfers, create and send handovers, count.
- `rejections_manager` — receive at store, approve variances, resolve disputes, approve counts, maintain rates.
- `rejections_viewer` — read-only.
- `super_admin` — deletes, lock bypass, masters.

The nuance is that whoever receives must differ from whoever sent — enforced per document (§6.10), not by a new role.

---

## 10. Phasing

**Phase 1 — Capture the count properly**
`rw_defect_grades`, `rw_defect_rates`, `rw_locations`, the entry-table additions
(`hour_slot`, `checked_by`, `product_id` on leakages, `defect_grade_id`,
`location_id`) with the per-interval unique index, `rw_ball_ledger` +
`rw_ball_stock` + posting trigger, `rw_ball_cutover()`, the Checker Interval Entry
screen, Floor Bin / Leaker WIP stock, Ball Ledger, and
`v_rw_interval_coverage` + `v_rw_defect_vs_production`.
*Deliverable: every interval count lands in a ledger keyed by model, with a running bin balance; missing intervals and implausible defect rates surface the same day.*

**Phase 2 — The two movements** *(the reconciliation asked for)*
`rw_cover_transfers` (Jorr cores → covered cheap balls) and `rw_handovers` (daily
floor → store, blind receipt, declared/sent/received). Store Stock page,
handover-variance, cover-variance and checker-accuracy views, locking on receipt.
*Deliverable: declared vs sent vs received is measured every day and attributed to named people; leaker cores cannot vanish between Jorr and covering.*

**Phase 3 — Store count and period close**
`rw_stock_counts` / `rw_stock_count_lines`, frozen snapshot, verify → approve,
adjustment posting, period lock, Reconciliation Dashboard.
*Deliverable: store book equals physical, proven, and back-dating is blocked.*

**Phase 4 — Sales and cost of quality**
Mirror store stock into `inventory_stock` against cheap-ball SKUs so the existing
sales/dispatch flow consumes it; `v_rw_cost_of_quality` against `standard_costs`;
optional GL posting.
*Deliverable: cheap balls sell out of the stock they were received into, and the money lost to defects becomes a reported number.*

Each phase ships independently and leaves the module working.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| A Jorr leaker core is counted at Jorr and **again** by the Final checker after covering | The cover transfer produces the covered stock directly; the Final checker screen is for new leakers only. Depends on segregation holding on the floor — decision B. |
| Checker screen too slow, so counts get batched at shift end and the interval grain is fake | Single mobile grid pre-filtered to models actually running; `v_rw_interval_coverage` shows batching as late or missing intervals |
| Storekeeper copies the sent figure | Blind receipt, enforced in UI and by the transition rule |
| Double capture vs `production_entries.quantity_rejected` | Decision A, resolved **before** Phase 1 |
| Model grid too wide if many models run at once | Grid is driven by the day's production entries, not the full product master |
| Rates drift and revalue history | `unit_cost` is snapshotted onto every ledger row at posting time |
| Cutover disputes over historical entries | Dated cutover + opening count, no fabricated backfill |

---

## 12. Remaining Decisions

Answered and now built into the design:
- **Leaker cores at Jorr are covered first, then sold** → `onward_route = 'cover_then_store'`, a `leaker_wip` bin at Jorr, and the `rw_cover_transfers` step (§4.7).
- **Counting is per ball model** → `product_id` on every entry, ledger row and handover line, and `rw_defect_rates` per model × defect grade (§4.2).
- **Handover is daily** → `UNIQUE (handover_date, from_location_id)`, declared column auto-summed from the day's entries, and the bin-must-empty check (§4.8).

Still open:

**A. `production_entries.quantity_rejected` vs `rw_rejections`.** Rejections are
entered in both places today. Which is the source of truth? Recommended: the R&W
checker entry becomes authoritative and the production figure derives from it, so
the two can never disagree. *Blocks Phase 1.*

**B. Segregation of leaker cores.** Once a Jorr leaker core is covered, does it go
straight to the cheap-ball store as an identified batch — or does it rejoin the
normal stream and get air-tested again at Final? If the latter, the Jorr count
becomes informational only and the cover-transfer step disappears. *Blocks Phase 2.*

**C. Interval definition.** Hourly, matching `hourly_production_entries.hour_slot`,
or a different fixed interval? Same for Day and Night shifts? *Blocks Phase 1.*

**D. Which departments have a checker?** Jorr and both Final departments are
assumed. Does Packing also count rejects?

**E. Cheap-ball SKUs.** Do products exist in `products` for cheap balls today, or
are they sold without a product record? Phase 4 needs one SKU per (model, defect
class).

**F. Store location.** Is the cheap-ball store the existing "Store department", or
a separate physical store? Who receives — and is that person distinct from the
floor person who sends?

**G. Cutover date.** From which date do entries start producing stock? Recommend
the 1st of the month you go live.

**H. Material wastage** (`rw_wastages` — compound, cloth off-cuts). Left as a pure
log by this plan. Bring into a separate scrap inventory later, or leave as is?
