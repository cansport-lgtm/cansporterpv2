# Gate Inward — Plan

Status: **Proposal / planning document** (no code changes yet).

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

## 2. What Gate Inward does (scope)

| Kind | Linked to | Who makes it | What it feeds |
|---|---|---|---|
| **Purchase** | One approved / ordered / partially received PO of the supplier | Guard at the gate | The GRN for that PO must name this entry |
| **Other** (Phase 2) | No PO: supplier sample, courier parcel, customer sales return, goods sent for repair coming back, etc. | Guard | The register only; the office closes it with a note |

Rules of thumb:

- **One entry per vehicle per PO.** A truck carrying goods for two POs gets two
  entries (the form offers "another entry for the same vehicle", copying the
  vehicle, driver and challan fields). This matches the GRN, which is also
  against one PO, so the link entry ↔ GRN stays one-to-one.
- **The guard records what the challan says**, not what the store counts.
  Per PO line: quantity as per challan and number of packages. The store's
  count is the GRN, as today.
- **Gate Inward never moves stock or money.** It does not insert GRNs, does
  not touch `quantity_received`, does not post vouchers. QC and GRN stay
  exactly as they are; they just start from a gate entry.
- **The guard never sees prices.** PO lines are served by a function that
  returns item, description, UOM, ordered and still-open quantity only.

## 3. Flow

```
guard makes entry ─► at_gate ─► (raw material: QC as today) ─► GRN made with this entry ─► grn_made
                        │
                        ├─► rejected   (office: vehicle turned away – wrong supplier, no PO, refused)
                        └─► cancelled  (office: entry made by mistake)
vehicle_out_at: the guard taps "Vehicle left" when the empty truck goes out (any status)
```

- Only an `at_gate` entry can be put on a GRN; `grn_made` is set by a trigger
  when the GRN row is inserted, so the app cannot forget it.
- A PO can have many entries over time (partial deliveries). An entry that has
  no GRN after N days (setting, default 3) is **stale**: shown in red on the
  register and notified every morning.
- Quantity on the challan above the PO's open quantity is allowed at the gate
  (the truck is already here) but flagged `has_excess` and notified to the
  purchase managers; over-receipt is still blocked at GRN as today.

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
                    CHECK (entry_kind IN ('purchase','other')),
  status            text NOT NULL DEFAULT 'at_gate'
                    CHECK (status IN ('at_gate','grn_made','rejected','cancelled')),
  entry_date        date NOT NULL,                 -- Asia/Karachi
  in_at             timestamptz NOT NULL DEFAULT now(),
  -- party
  supplier_id       uuid REFERENCES suppliers(id),
  party_name        text,                          -- 'other' kind, or supplier name snapshot
  purchase_order_id uuid REFERENCES purchase_orders(id),
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
  has_excess        boolean NOT NULL DEFAULT false,
  -- lifecycle
  created_by        uuid NOT NULL REFERENCES app_users(id),   -- the guard
  vehicle_out_at    timestamptz,
  vehicle_out_by    uuid REFERENCES app_users(id),
  grn_id            uuid REFERENCES goods_receipt_notes(id),
  grn_made_at       timestamptz,
  rejected_by       uuid, rejected_at timestamptz, reject_reason text,
  cancelled_by      uuid, cancelled_at timestamptz, cancel_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (entry_kind <> 'purchase' OR (supplier_id IS NOT NULL AND purchase_order_id IS NOT NULL))
);

CREATE TABLE gate_inward_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id          uuid NOT NULL REFERENCES gate_inward_entries(id) ON DELETE CASCADE,
  po_item_id        uuid REFERENCES purchase_order_items(id),
  item_id           uuid REFERENCES items(id),
  description       text NOT NULL,
  uom               text,
  ordered_quantity  numeric,                       -- snapshot at the gate
  open_quantity     numeric,                       -- ordered − received − at gate, snapshot
  challan_quantity  numeric NOT NULL CHECK (challan_quantity > 0),
  packages          integer,
  remarks           text
);

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
  allow_other_kind boolean NOT NULL DEFAULT false
);

ALTER TABLE goods_receipt_notes ADD COLUMN gate_inward_id uuid REFERENCES gate_inward_entries(id);
CREATE UNIQUE INDEX ON goods_receipt_notes (gate_inward_id) WHERE gate_inward_id IS NOT NULL;
```

Views:

- `v_gate_inward_register` — entries with supplier, PO number, GRN number, age
  in days, `is_stale`, line count and total challan quantity, for the register
  and the cards.
- `v_purchase_order_gate_inward` — per PO: entries at gate, quantity at gate
  per line (so the PO page and the GRN form can show "arrived, not yet
  received").

## 5. Database functions (all SECURITY DEFINER, role-checked, tables SELECT-only)

| Function | Who | Does |
|---|---|---|
| `gate_inward_open_pos(p_supplier_id)` | gate, office | POs of the supplier in approved / ordered / partially_received, not closed short, with open quantity > 0. No amounts. |
| `gate_inward_open_lines(p_po_id)` | gate, office | PO lines: item code / name, description, UOM, ordered, received, already at gate, open. **No unit price.** |
| `gate_inward_save(p_id, p_data jsonb)` | gate | Insert (or edit while `at_gate`, by the maker or a manager). Validates supplier ↔ PO, lines belong to the PO, quantities > 0; sets `has_excess`; assigns `GIN-` on success; logs `created`; notifies (§8). |
| `gate_inward_vehicle_out(p_id)` | gate | Sets `vehicle_out_at/by`, logs `vehicle_out`. Idempotent. |
| `gate_inward_reject(p_id, p_reason)` | office | `at_gate → rejected`. Notifies the guard who made it. |
| `gate_inward_cancel(p_id, p_reason)` | office; the maker while `at_gate` and no GRN | `at_gate → cancelled`. |
| `gate_inward_log_rescan(p_id)` | gate | Logs a `rescan_attempt` when a slip already closed is scanned again (no siren — an inward slip scanned twice is not a security risk; the page just shows the status). |
| `gate_inward_settings_update(p jsonb)` | super_admin | Settings row. |

Triggers on the purchase side:

- `trg_gate_inward_on_grn` (AFTER INSERT on `goods_receipt_notes`): when
  `gate_inward_id` is set, require the entry to be `at_gate` and for the same
  PO, then set `status = 'grn_made'`, `grn_id`, `grn_made_at`, log `grn_made`.
  On GRN delete, reopen the entry to `at_gate` (keeps the register honest if a
  GRN is removed).
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
| New Inward Entry | `/gate-pass/inward/new` | guard, gate pass manager | Supplier search → open POs of that supplier → PO lines with *challan quantity* and *packages* inputs (excess shown in amber) → vehicle number, driver, contact, transporter, challan no. and date, packages, gross weight, challan photo, vehicle photo, remarks → **Save & print slip**. "Another entry for the same vehicle" keeps the vehicle block. Uses the guard's dark `GuardShell` for `gate_security`. |
| Inward Entry | `/gate-pass/inward/:id` | guard (own, read + vehicle out), office | Printable slip with QR (`GIN-` number, date / time in, supplier, PO, vehicle, challan, lines with challan quantity, guard's name), photos, timeline (events), buttons: Vehicle left, Reject, Cancel, **Make GRN** (opens Goods Receipt with the entry preselected). |
| Gate Inward Register | `/purchase/gate-inward` | purchase officer / manager, store, admin | Today by default; filters by date range, supplier, PO, status. Cards: **At gate today**, **Awaiting GRN** (stale in red), **Rejected (7 days)**, **Received (GRN made) today**. Print the day's gate register. |
| Goods Receipt | `/purchase/grn` (existing) | purchase | New **Gate inward entry** picker after the PO is chosen, listing that PO's `at_gate` entries (number, date, vehicle, challan). Choosing one pre-fills the receipt date, invoice/challan number, and each line's quantity from the challan. Required when the setting is on. |
| Purchase Dashboard | `/purchase/dashboard` (existing) | purchase | Card **Vehicles at gate awaiting GRN** with count and oldest age. |
| Gate Pass Dashboard | `/gate-pass/dashboard` (existing) | gate pass | Card **Inward today**. |
| Settings | Gate Inward section on the existing purchase / gate settings page | super_admin | Require for GRN (+ categories), stale days, allow "other" kind. |

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
| `purchase_manager`, `admin` | As officer, plus receive the excess and stale notifications |
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
| Excess quantity on the challan | purchase managers |
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
- Nothing in stock, consumption closing, accounting, or the outward gate pass
  changes.

## 10. Phasing

**Phase 1 — record at the gate, receive against it (optional)**
1. Migration + rollback: tables, sequence, views, functions, GRN triggers
   (enforcement setting **off**), notifications on save.
2. Gate Check Inward tab, New Inward Entry, Inward Entry page with printable
   slip and QR, `gate_security` route updates.
3. Gate Inward Register with cards and the daily printout.
4. Goods Receipt picker + pre-fill; GRN dialog / print show the gate data.
5. `docs/GATE_INWARD.md` in the style of `GATE_PASS.md`; enum-free, so
   `types.ts` needs no change (tables accessed through a `giDb` cast like
   `gpDb`).

**Phase 2 — make it the rule**
6. Switch `require_for_grn` on for raw material (then all categories once the
   gate is reliable); stale morning notification; excess flag notification;
   dashboard cards; PO "At gate" column; QC form shows gate entries.

**Phase 3 — beyond purchase**
7. "Other" kind for non-PO arrivals; link customer sales returns and the
   returnable / job-work goods coming back (`gate_pass_receipts`) to an
   inward entry so every inbound vehicle is in one register; weighbridge
   gross / tare / net where the supplier bills by weight.

## 11. Risks and how the design handles them

- **Guards typing wrong quantities.** They copy the challan and photograph it;
  the store's GRN count is still the stock figure. The slip shows both later.
- **Blocking receipts before the gate is trained.** Enforcement is a setting,
  off by default, per category.
- **Multi-PO trucks.** One entry per PO keeps the GRN link one-to-one; the
  form copies the vehicle block to make the second entry a few taps.
- **Vehicle numbers typed differently.** Normalised with the existing
  `gate_pass_norm_vehicle` (uppercase, no spaces or dashes) for search.
- **Price leakage to the guard.** Lines come from a function without prices;
  `canViewPrices` already returns false for `gate_security`.

## 12. Decisions needed before building

1. **One PO per entry** (recommended, matches GRN) — or allow several POs on
   one entry and split into several GRNs later?
2. **Enforcement from day one?** Recommended: Phase 1 optional, Phase 2
   required for raw material, then all categories.
3. **What the guard enters per line:** challan quantity per PO line
   (recommended, gives "at gate" quantities per item) — or only the total
   package count plus a challan photo, with the office filling lines later?
4. **Who is notified on every entry:** purchase officers + managers + store
   operator (proposed). Add anyone else (e.g. QC inspector for raw material)?
5. **Weighbridge:** needed in Phase 1 for any supplier billed by weight?
6. **Non-PO arrivals** (samples, courier, returns): Phase 3 as proposed, or
   needed sooner?
