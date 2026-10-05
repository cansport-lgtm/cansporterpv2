# Gate Inward — Plan

Status: **Phase 1 implemented** (`supabase/migrations/20261005120000_gate_inward.sql`, see `docs/GATE_INWARD.md`). Phases 2 and 3 below are still proposals.

Gate Inward is the security gate's record of every vehicle that brings goods
**into** the factory, made at the gate before anything reaches the store. It is
the inward mirror of the outward Gate Pass (`GP-`): the guard makes the entry,
the office receives against it, and nothing can be received in stores that
never came through the gate.

Number series: `GIN-000001`, `GIN-000002`, … (given only when the entry saves,
so failed saves never leave gaps, same as `GP-`).

## 1. Current state (what we build on)

- **Purchase today:** PO (`PO-00001`) → for raw material a QC inspection
  (`QC-00001`, `purchase_qc_inspections`) → GRN (`GRN-00001`,
  `goods_receipt_notes` + `grn_items`). A trigger blocks a raw-material GRN
  until `purchase_orders.qc_status = 'passed'`. GRN triggers update
  `purchase_order_items.quantity_received`, move the PO to
  partially_received / received, and feed consumption stock closing. The
  accounting voucher is posted from the client (`postGRNVoucher`).
- **GRN has no gate data.** Its only transport fields are `invoice_number`,
  `invoice_date`, `invoice_amount`, `transportation_cost`. No vehicle, driver,
  challan / bilty, or gate time. Whether the goods actually arrived, when, and
  on what vehicle is not recorded anywhere.
- **Outward gate pass** already gives us the pieces to copy: the guard's Gate
  Check page (QR scan + typed number, Goods / vehicle and Worker modes), the
  `gate_security` role locked to `/gate-pass/check`, `PhotoInput` on the
  `gate-pass-photos` bucket, the gap-free numbering pattern, SELECT-only RLS
  with every write through `gate_pass_*` SECURITY DEFINER functions, an events
  table per module, `notify_role` / `notify_user`, and the pg_cron morning
  reminder.
- **Roles** are the `app_role` enum plus hand-maintained maps in
  `AuthContext.tsx` (module access, route whitelist, locked roles) and lists in
  `RolesPage`, `UsersPage`, `ProtectedRoute`, `RoleBasedRedirect`,
  `ERPSidebar`.
- Nothing named inward / gate entry exists yet; the namespace is free.

## 2. Gate In types

The outward module has one pass per reason for leaving; Gate In has one entry
per reason for arriving. Every type is closed by the office record that
already exists for it, so the gate never duplicates stores or accounts work.

| Type | Linked to | Guard enters | Closed by (status) | Phase |
|---|---|---|---|---|
| **Purchase** | One approved / ordered / partially received **raw material** PO of the supplier (categories are a setting) | Supplier, PO, vehicle, driver, challan no. and photo, packages (optional). **No quantities** | The GRN for that PO names this entry → `grn_made` | 1 |
| **Returnable back** | A Returnable gate pass (`GP-`) that is out / partly returned | The pass number (scan the original slip), vehicle, driver. No quantities | "Receive goods" on the pass (`GPR-`) names this entry → `received` | 1 |
| **Job work back** | A Job work gate pass that is out | The pass number, vehicle, driver. No quantities | `GPR-` receipt on the pass → `received` | 1 |
| **Sales return** | Customer (and the dispatch if the driver has the invoice / dispatch number) | Customer, optional dispatch, cartons (optional) | A sales return (`sales_returns`) names this entry → `received` | 2 |
| **Sample / free supply** | Supplier or anyone; no PO | What it is, in one line; packages | Office closes with a note ("received by …") → `closed` | 2 |
| **Empty vehicle for loading** | Transporter / customer vehicle arriving empty to load a dispatch or scrap | Vehicle, driver, who it came for | Automatically when an outward pass goes **Out** on that vehicle the same day → `loaded_out`; this gives the register an in-time for every vehicle that leaves on a `GP-`. Super admin sets whether it is **off**, **optional** or **compulsory** (see §5) | 2 |
| **Other** | Courier, documents, contractor material, anything else | Free text | Office closes with a note → `closed` | 2 |
| **Manual backfill** | Any type above, entered later from the paper inward register | Paper book and serial, date and time on paper, photo of the page | Same as its type, dated on paper | 3 |

Not Gate In types: visitor and staff vehicles carry no goods and belong in a
visitor log, not the goods register. Spare parts, machines and fixed assets
arrive either on a PO (Purchase) or back from repair (Returnable back), so
they need no type of their own.

Rules of thumb:

- **One entry per vehicle per PO.** A truck carrying goods for two POs gets two
  entries (the form offers "another entry for the same vehicle", copying the
  vehicle, driver and challan fields). This matches the GRN, which is also
  against one PO, so the link entry ↔ GRN stays one-to-one.
- **The guard records the movement, not the goods.** Who came, on what
  vehicle, against which PO or pass, when, with a photo of the challan.
  Quantities are the store's job: the GRN (purchase) or the `GPR-` receipt
  (returnable / job work) carry them, as today. So there is no line table at
  the gate and nothing for the guard to count.
- **Gate Inward never moves stock or money.** It does not insert GRNs, does
  not touch `quantity_received`, does not post vouchers. QC and GRN stay
  exactly as they are; they just start from a gate entry.
- **The guard never sees prices or quantities.** The PO picker is served by
  a function that returns PO number, date and supplier only.

## 3. Flow

```
guard makes entry ─► at_gate ─► Purchase:         (raw material: QC as today) ─► GRN names the entry ─► grn_made
                        │       Returnable / job work back: GPR receipt names the entry ─────────────► received
                        │       Sales return:     sales return names the entry ────────────────────► received
                        │       Sample / other:   office closes with a note ───────────────────────► closed
                        │       Empty for loading: outward GP goes Out on this vehicle ─────────────► loaded_out
                        ├─► rejected   (office: vehicle turned away – wrong supplier, no PO, refused)
                        └─► cancelled  (office: entry made by mistake)
vehicle_out_at: the guard taps "Vehicle left" when the empty truck goes out (any status)
```

- Only an `at_gate` entry can be named on a GRN, a `GPR-` receipt or a sales
  return; the closing status is set by a trigger when that row is inserted,
  so the app cannot forget it.
- A PO can have many entries over time (partial deliveries). An entry that has
  no GRN after N days (setting, default 3) is **stale**: shown in red on the
  register and notified every morning.

## 4. Data model

Migration `supabase/migrations/2026MMDD120000_gate_inward.sql` with a rollback
`supabase/rollbacks/2026MMDD120000_gate_inward_down.sql`. No new enum values
in Phase 1 (existing roles cover it, see §7), so no separate role migration.

```sql
CREATE SEQUENCE gate_inward_number_seq;

CREATE TABLE gate_inward_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number      text NOT NULL UNIQUE,          -- GIN-000001, set on successful save
  entry_kind        text NOT NULL DEFAULT 'purchase'
                    CHECK (entry_kind IN ('purchase','returnable_return','job_work_return',
                                          'sales_return','sample','loading_vehicle','other')),
  status            text NOT NULL DEFAULT 'at_gate'
                    CHECK (status IN ('at_gate','grn_made','received','closed','loaded_out',
                                      'rejected','cancelled')),
  entry_date        date NOT NULL,                 -- Asia/Karachi
  in_at             timestamptz NOT NULL DEFAULT now(),
  -- party and the record this entry arrives against (one of them, by type)
  supplier_id       uuid REFERENCES suppliers(id),         -- purchase, sample
  customer_id       uuid REFERENCES customers(id),         -- sales_return, loading_vehicle
  party_name        text,                                  -- free text for other / snapshot
  purchase_order_id uuid REFERENCES purchase_orders(id),   -- purchase
  gate_pass_id      uuid REFERENCES gate_passes(id),       -- returnable_return, job_work_return
  dispatch_id       uuid REFERENCES sales_dispatches(id),  -- sales_return (optional)
  -- vehicle & documents
  vehicle_number    text NOT NULL,
  driver_name       text,
  driver_contact    text,
  transporter_name  text,
  challan_number    text,                          -- supplier challan / bilty
  challan_date      date,
  packages_count    integer,
  gross_weight_kg   numeric,
  challan_photo_path text,                         -- gate-pass-photos/inward-challan/…
  vehicle_photo_path text,                         -- gate-pass-photos/inward-vehicle/…
  remarks           text,
  -- lifecycle
  created_by        uuid NOT NULL REFERENCES app_users(id),   -- the guard
  vehicle_out_at    timestamptz,
  vehicle_out_by    uuid REFERENCES app_users(id),
  -- what closed it (one of them, by type)
  grn_id            uuid REFERENCES goods_receipt_notes(id),   -- purchase
  gate_pass_receipt_id uuid REFERENCES gate_pass_receipts(id), -- returnable / job work back
  sales_return_id   uuid REFERENCES sales_returns(id),         -- sales_return
  out_gate_pass_id  uuid REFERENCES gate_passes(id),           -- loading_vehicle
  closed_by         uuid, closed_at timestamptz, close_note text,  -- sample / other, and the timestamp for every closing
  rejected_by       uuid, rejected_at timestamptz, reject_reason text,
  cancelled_by      uuid, cancelled_at timestamptz, cancel_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (entry_kind <> 'purchase' OR (supplier_id IS NOT NULL AND purchase_order_id IS NOT NULL)),
  CHECK (entry_kind NOT IN ('returnable_return','job_work_return') OR gate_pass_id IS NOT NULL)
);

-- No line table: the gate records the movement only (decision 3 in §12).

CREATE TABLE gate_inward_events (                 -- audit log, same shape as gate_pass_events
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES gate_inward_entries(id) ON DELETE CASCADE,
  event text NOT NULL,                             -- created, vehicle_out, grn_made, rejected, cancelled, rescan_attempt
  message text, details jsonb,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gate_inward_settings (               -- single row
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  require_for_grn boolean NOT NULL DEFAULT false,  -- Phase 2 switches this on
  require_for_categories purchase_category[] NOT NULL DEFAULT '{raw_material}',
  stale_days integer NOT NULL DEFAULT 3,
  purchase_categories purchase_category[] NOT NULL DEFAULT '{raw_material}',  -- POs the guard can pick
  enabled_kinds text[] NOT NULL DEFAULT '{purchase,returnable_return,job_work_return}',  -- types the guard can pick
  loading_vehicle_mode text NOT NULL DEFAULT 'optional'
    CHECK (loading_vehicle_mode IN ('off','optional','required'))  -- see §5
);

-- The closing records point back at the entry (one entry per record)
ALTER TABLE goods_receipt_notes  ADD COLUMN gate_inward_id uuid REFERENCES gate_inward_entries(id);
ALTER TABLE gate_pass_receipts   ADD COLUMN gate_inward_id uuid REFERENCES gate_inward_entries(id);
ALTER TABLE sales_returns        ADD COLUMN gate_inward_id uuid REFERENCES gate_inward_entries(id);
CREATE UNIQUE INDEX ON goods_receipt_notes (gate_inward_id) WHERE gate_inward_id IS NOT NULL;
CREATE UNIQUE INDEX ON gate_pass_receipts  (gate_inward_id) WHERE gate_inward_id IS NOT NULL;
CREATE UNIQUE INDEX ON sales_returns       (gate_inward_id) WHERE gate_inward_id IS NOT NULL;
```

Views:

- `v_gate_inward_register` — entries with supplier / party, PO or pass
  number, closing record number, age in days and `is_stale`, for the register
  and the cards.
- `v_purchase_order_gate_inward` — per PO: entries at gate and received (so
  the PO page and the GRN form can show "vehicle arrived, not yet received").

## 5. Database functions (all SECURITY DEFINER, role-checked, tables SELECT-only)

| Function | Who | Does |
|---|---|---|
| `gate_inward_open_pos(p_supplier_id)` | gate, office | POs of the supplier in approved / ordered / partially_received, not closed short, still having something to receive, in the categories of `purchase_categories`. Returns PO number, date, expected date only: **no amounts, no quantities.** |
| `gate_inward_open_passes(p_number)` | gate, office | Returnable / job-work passes that are `out` or `partially_returned`, by number or party: pass number, party, vehicle on the pass, due-back date. No lines, no rates. |
| `gate_inward_save(p_id, p_data jsonb)` | gate | Insert (or edit while `at_gate`, by the maker or a manager). Checks the type is enabled, the linked record matches the type (supplier ↔ PO in an allowed category; pass is a returnable / job-work pass still out), a vehicle number is given; assigns `GIN-` on success; logs `created`; notifies (§8). |
| `gate_inward_vehicle_out(p_id)` | gate | Sets `vehicle_out_at/by`, logs `vehicle_out`. Idempotent. |
| `gate_inward_close(p_id, p_note)` | office | Sample / other only: `at_gate → closed` with who received it. |
| `gate_inward_reject(p_id, p_reason)` | office | `at_gate → rejected`. Notifies the guard who made it. |
| `gate_inward_cancel(p_id, p_reason)` | office; the maker while `at_gate` and no GRN | `at_gate → cancelled`. |
| `gate_inward_log_rescan(p_id)` | gate | Logs a `rescan_attempt` when a slip already closed is scanned again (no siren — an inward slip scanned twice is not a security risk; the page just shows the status). |
| `gate_inward_settings_update(p jsonb)` | super_admin | Settings row. |

Triggers on the closing records (one pattern, three tables):

- `trg_gate_inward_on_grn` (AFTER INSERT on `goods_receipt_notes`): when
  `gate_inward_id` is set, require the entry to be `at_gate`, of type
  purchase and for the same PO, then set `status = 'grn_made'`, `grn_id`,
  `closed_at`, log `grn_made`. On GRN delete, reopen the entry to `at_gate`
  (keeps the register honest if a GRN is removed).
- `trg_gate_inward_on_gpr` (AFTER INSERT on `gate_pass_receipts`): same for
  returnable / job-work back → `received`, `gate_pass_receipt_id`; the entry
  must be for the same outward pass. The outward "Receive goods" form gets a
  picker of that pass's `at_gate` entries (pre-fills the receipt date).
- `trg_gate_inward_on_sales_return` (AFTER UPDATE OF status to `posted` on
  `sales_returns`): → `received`, `sales_return_id`.
- `gate_pass_mark_out` (existing outward function): after marking a pass out,
  close any `loading_vehicle` entry of the same day whose normalised vehicle
  number matches → `loaded_out`, `out_gate_pass_id`.

**Empty vehicle for loading: the super admin setting** (`loading_vehicle_mode`)

| Mode | Guard sees | Outward gate check |
|---|---|---|
| `off` | The type is hidden | Unchanged |
| `optional` (default) | The type is offered; recording the empty vehicle is up to the gate | Unchanged; if an entry exists it is closed automatically |
| `required` | The type is offered and the Gate Check page shows "Vehicle in?" next to the vehicle field | `gate_pass_gate_check` refuses **Out** when no `at_gate` loading-vehicle entry exists today for the vehicle number the guard typed: "No gate-in entry for this vehicle — record the vehicle in first". The guard makes the inward entry from the same screen and retries. Scrap, sales, sample and every other outward type are treated alike; manual backfill passes are exempt (they are entered after the fact). |

The check uses the vehicle number the guard types at the gate (normalised),
not the one printed on the pass, so a changed truck still matches the entry
the guard made when it came in.
- `trg_enforce_gate_inward_before_grn` (BEFORE INSERT on
  `goods_receipt_notes`): when `require_for_grn` is on and the PO's category
  is in `require_for_categories`, block a GRN without `gate_inward_id`
  (message: "Make the gate inward entry first"). Off by default so the
  current GRN flow keeps working until the gate is trained.

Role helpers reuse the outward pattern: `gate_inward_can('gate')` =
super_admin, gate_pass_manager, gate_security; `gate_inward_can('office')` =
super_admin, admin, purchase_manager, purchase_officer, gate_pass_manager.
Roles are compared as text, as in `gate_pass_has_any_role`.

Audit: `audit_row_change('purchase')` on the two main tables, like the other
purchase tables.

## 6. Pages

| Page | Route | Who | What it shows |
|---|---|---|---|
| Gate Check → **Inward** tab | `/gate-pass/check` | guard | Third mode next to Goods / vehicle and Worker. Scan or type a `GIN-` number to open an entry (status, vehicle, "Vehicle left" button); big **New inward entry** button. |
| New Inward Entry | `/gate-pass/inward/new` | guard, gate pass manager | **Type** first (big buttons, only the enabled types). Purchase: supplier search → open raw-material POs of that supplier → pick one. Returnable / job work back: scan or type the `GP-` number → the pass card (party, vehicle on the pass, due back) → confirm. Sales return: customer, optional dispatch. Sample / other: one line of text. Then the common vehicle block: vehicle number, driver, contact, transporter, challan no. and date, packages, gross weight, challan photo, vehicle photo, remarks → **Save & print slip**. "Another entry for the same vehicle" keeps the vehicle block. Uses the guard's dark `GuardShell` for `gate_security`. |
| Inward Entry | `/gate-pass/inward/:id` | guard (own, read + vehicle out), office | Printable slip with QR (`GIN-` number, date / time in, supplier, PO, vehicle, challan, packages, guard's name), photos, timeline (events), buttons: Vehicle left, Reject, Cancel, **Make GRN** (opens Goods Receipt with the entry preselected). |
| Gate Inward Register | `/purchase/gate-inward` | purchase officer / manager, store, admin | Today by default; filters by date range, supplier, PO, status. Cards: **At gate today**, **Awaiting GRN** (stale in red), **Rejected (7 days)**, **Received (GRN made) today**. Print the day's gate register. |
| Goods Receipt | `/purchase/grn` (existing) | purchase | New **Gate inward entry** picker after the PO is chosen, listing that PO's `at_gate` entries (number, date, vehicle, challan). Choosing one pre-fills the receipt date and the invoice / challan number; the store still enters every quantity itself. Required when the setting is on. |
| Purchase Dashboard | `/purchase/dashboard` (existing) | purchase | Card **Vehicles at gate awaiting GRN** with count and oldest age. |
| Gate Pass Dashboard | `/gate-pass/dashboard` (existing) | gate pass | Card **Inward today**. |
| Settings | Gate Inward section on the existing purchase / gate settings page | super_admin | Require for GRN (+ categories), stale days, enabled types, empty-vehicle mode (off / optional / compulsory). |

Sidebar: **Gate Inward Register** under the Purchase group; **New Inward
Entry** under Gate Pass (allowedRoles: super_admin, gate_pass_manager,
gate_security). `gate_security` stays locked to its pages: the `gate_security`
route whitelist in `AuthContext` and the redirect list in `ProtectedRoute`
gain `/gate-pass/inward/new` and `/gate-pass/inward/:id`; the module scope
stays `gate_pass`, so the guard never enters `/purchase/*`.

## 7. Roles (no new role in Phase 1)

| Role | Can |
|---|---|
| `gate_security` | New inward entry, open an entry by number, Vehicle left; never sees prices or amounts |
| `gate_pass_manager` | Everything the guard can, plus edit an `at_gate` entry and cancel |
| `purchase_officer` | Register, entry page, make the GRN from an entry, reject / cancel |
| `purchase_manager`, `admin` | As officer, plus receive the stale notifications |
| `store_operator` | Register read-only (so the store knows what is at the gate) |
| `super_admin` | Everything, plus settings |

If the factory later wants a dedicated inward clerk who is not a security
guard, a `gate_inward_officer` role can be added with the two-step enum
migration pattern; the functions compare roles as text so nothing else
changes.

## 8. Notifications (module `purchase`, link to the entry page)

| Event | To |
|---|---|
| Entry saved | purchase officers and managers, store operator (and super admins) — "GIN-000012 · PO-00045 · Supplier · vehicle ABC-123 at gate" |
| Rejected / cancelled by the office | the guard who made it |
| Stale: at gate for more than `stale_days` with no GRN | purchase managers, every morning 09:10 Pakistan time (pg_cron, guarded like `gate-pass-overdue`) |

The GRN notification that already exists ("Goods Received") now also carries
the `GIN-` number in its message.

## 9. Effects on existing pages

- **Goods Receipt:** the entry picker above; the GRN view dialog and
  `printGRN` show the gate entry number, date / time in, vehicle and challan
  number. The label "Supplier Invoice / Challan" stays for `invoice_number`.
- **Purchase Orders:** an **At gate** column (quantity arrived but not yet
  received) and the list of entries on the PO detail.
- **QC Inspections:** (Phase 2) the inspection form shows the gate entries of
  the PO so the inspector knows which lot arrived; optional `gate_inward_id`
  on `purchase_qc_inspections`.
- **Gate Pass → Receive goods** (returnable / job work): a picker of the
  pass's `at_gate` inward entries; choosing one pre-fills the receipt date.
  The pass page and the Returns & Job Work page show "vehicle arrived, not
  yet received" in amber.
- **Sales Returns:** a picker of the customer's `at_gate` sales-return entries;
  the return note prints the `GIN-` number and vehicle.
- **Gate Pass Dashboard / list:** vehicles that came in empty for loading and
  have not gone out yet.
- Nothing in stock, consumption closing, accounting, or the outward gate pass
  changes.

## 10. Phasing

**Phase 1 — Purchase, Returnable back, Job work back (linking optional)**
1. Migration + rollback: tables, sequence, views, functions, the three
   closing triggers (GRN enforcement setting **off**), notifications on save.
2. Gate Check Inward tab, New Inward Entry with the type picker, Inward Entry
   page with printable slip and QR, `gate_security` route updates.
3. Gate Inward Register with cards, type filter and the daily printout.
4. Goods Receipt picker; GRN dialog / print show the gate data;
   Receive goods picker on the outward pass.
5. `docs/GATE_INWARD.md` in the style of `GATE_PASS.md`; enum-free, so
   `types.ts` needs no change (tables accessed through a `giDb` cast like
   `gpDb`).

**Phase 2 — make it the rule, add the remaining types**
6. Switch `require_for_grn` on for raw material (then all categories once the
   gate is reliable); stale morning notification;
   dashboard cards; PO "At gate" column; QC form shows gate entries.
7. Enable Sales return, Sample / free supply, Empty vehicle for loading and
   Other; sales-return picker; auto-close of loading vehicles on gate out.

**Phase 3 — paper and weight**
8. Manual backfill from the paper inward register (reusing the paper-book
   tables and rules of the outward module); weighbridge gross / tare / net
   where the supplier bills by weight.

## 11. Risks and how the design handles them

- **Guards typing wrong quantities.** They type none. The challan photo is
  the record; the store's GRN count is the stock figure.
- **Blocking receipts before the gate is trained.** Enforcement is a setting,
  off by default, per category.
- **Multi-PO trucks.** One entry per PO keeps the GRN link one-to-one; the
  form copies the vehicle block to make the second entry a few taps.
- **Vehicle numbers typed differently.** Normalised with the existing
  `gate_pass_norm_vehicle` (uppercase, no spaces or dashes) for search.
- **Price or quantity leakage to the guard.** The PO and pass pickers come
  from functions that return headers only; `canViewPrices` already returns
  false for `gate_security`.

## 12. Decisions needed before building

1. **One PO per entry** (recommended, matches GRN) — or allow several POs on
   one entry and split into several GRNs later?
2. **Enforcement from day one?** Recommended: Phase 1 optional, Phase 2
   required for raw material, then all categories.
3. ~~What the guard enters per line~~ **Decided:** nothing per line. The
   guard records the gate-in movement only (supplier, PO, vehicle, driver,
   challan photo); Purchase entries are for raw-material POs by default
   (`purchase_categories` setting). No line table.
4. ~~Who is notified on every entry~~ **Decided:** purchase officers,
   purchase managers and the store operator.
5. **Weighbridge:** needed in Phase 1 for any supplier billed by weight?
6. ~~Which types in Phase 1~~ **Decided:** Purchase + Returnable back + Job
   work back.
7. ~~Empty vehicle for loading~~ **Decided:** yes, with a super admin setting
   `loading_vehicle_mode` = off / optional / compulsory (default optional;
   compulsory blocks the outward gate-out without a gate-in entry).
