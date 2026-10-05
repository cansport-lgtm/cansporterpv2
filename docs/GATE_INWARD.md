# Gate Inward (vehicles bringing goods in)

The security gate's record of every vehicle that brings goods **into** the
factory, made before anything reaches the store. One number series for all
types: `GIN-000001`, `GIN-000002`, … A number is given only when the entry
saves, so failed saves never leave gaps (same as `GP-`).

Database: `supabase/migrations/20261005120000_gate_inward.sql`. Rollback in
`supabase/rollbacks/20261005120000_gate_inward_down.sql`. No new roles. The
planning document with the full design and the later phases is
`docs/GATE_INWARD_PLAN.md`.

## What the guard records

The **movement, not the goods**: who came, on what vehicle, against which
purchase order or outward pass, when, with a photo of the challan. There are
no quantities and no line table at the gate. Quantities stay where they are
today: the GRN (purchase) and the `GPR-` receipt (returnable / job work).

## Types

| Type | Arrives against | Guard enters | Closed by → status | Enabled |
|---|---|---|---|---|
| **Purchase** | One approved / ordered / partially received PO of the supplier, in the categories allowed by the settings (raw material by default) | Supplier, PO, vehicle, driver, challan no. and photo, packages | The GRN for that PO names the entry → `grn_made` | Yes |
| **Returnable back** | A Returnable gate pass (`GP-`) that is out / partly returned | The pass (scan the old slip or type its number), vehicle, driver | "Receive goods" on the pass (`GPR-`) names the entry → `received` | Yes |
| **Job work back** | A Job work pass that is out | Same | Same | Yes |
| Sales return | Customer, optional dispatch | — | Office closes with a note for now (the sales-return link is Phase 2) | Off |
| Sample / free supply | Supplier or anyone, no PO | — | Office closes with a note → `closed` | Off |
| Empty vehicle for loading | Transporter arriving empty to load | — | Office closes with a note for now (auto-close on gate out is Phase 2) | Off |
| Other | Courier, documents, contractor material | — | Office closes with a note → `closed` | Off |

Super admins enable types in the settings (Gate Inward Register page).

## Flow

```
guard records the vehicle → at_gate → purchase:   GRN names the entry ──────────► grn_made
                                  │   returnable / job work back: GPR receipt names it ► received
                                  │   sample / other: office closes with a note ─────► closed
                                  ├─► rejected   (office: vehicle turned away)
                                  └─► cancelled  (office, or the guard who made it)
Vehicle left: the guard taps it when the empty truck goes out (any status).
```

- Only an `at_gate` entry can be named on a GRN or a receipt; the closing
  status is set by a database trigger / function, never by the page.
- A PO can have many entries over time (partial deliveries). An entry with
  no GRN after N days (setting, default 3) is **stale**: red on the register.
- Deleting a GRN reopens its entry to `at_gate`.

## Pages

| Page | Route | Who |
|---|---|---|
| Gate Check → **Inward** tab | `/gate-pass/check` | Guard. Scan or type a `GIN-` number to open an entry and tap **Vehicle left**; or **New inward entry** |
| New Inward Entry | `/gate-pass/inward/new` | Guard, gate pass manager, purchase office. Type first, then supplier → PO (or the `GP-` pass), then vehicle, driver, transporter, challan, packages, photos. **Save & print slip**, or **Save & add another for the same vehicle** (a truck with two POs gets two entries) |
| Inward Entry | `/gate-pass/inward/:id` (guard) · `/purchase/gate-inward/:id` (office) | Slip with QR, photos, history; Vehicle left, Edit (while at gate), Make GRN, Receive goods, Reject, Cancel, Close |
| Gate Inward Register | `/purchase/gate-inward` | Purchase officers and managers, admins, store operator (read). Cards (at gate today, awaiting receipt with stale in red, received today, rejected 7 days), the **At the gate now** list, filters, Excel export, printable day register, and the settings (super admin) |
| Goods Receipt | `/purchase/grn` | **Gate inward entry** picker after the PO: the vehicles at the gate for that PO. Choosing one pre-fills the receipt date and the challan number; the store still enters every quantity. Required when the setting is on. **Make GRN** on an entry opens this with the entry chosen |
| Gate pass page → Receive goods | `/gate-pass/passes/:id` | A **Came in on gate entry** picker (the pass's entries at the gate, latest preselected). The pass page and Returns & Job Work show "At gate — receive" |

The guard's pages use the dark guard shell; `gate_security` is confined to
`/gate-pass/check` and `/gate-pass/inward/*`.

## Roles (none added)

| Role | Can |
|---|---|
| `gate_security` | New inward entry, open an entry, Vehicle left, edit / cancel own entry while at gate. Never sees prices or quantities: the PO and pass pickers are database functions that return headers only |
| `gate_pass_manager` | As the guard, plus reject / cancel / close any entry |
| `purchase_officer`, `purchase_manager`, `admin` | Register, entry page, Make GRN, reject / cancel / close |
| `store_operator` | Register read-only (what is at the gate) |
| `super_admin` | Everything, plus settings |

Every write goes through the `gate_inward_*` database functions, which check
these roles; the tables are read-only to the app.

## Settings (super admin, on the register page)

| Setting | Default | Effect |
|---|---|---|
| No GRN without a gate inward entry | Off | When on, a GRN in the categories below is blocked unless it names an entry (`trg_gate_inward_check_grn`) |
| Required for | Raw material | Categories the rule applies to |
| Purchase orders the guard can pick | Raw material | Categories of PO offered on the gate's Purchase entry |
| Inward types the guard can pick | Purchase, Returnable back, Job work back | |
| Stale after | 3 days | Red on the register |

## Notifications (module `purchase`)

| Event | To |
|---|---|
| Vehicle at gate (entry saved) | Purchase officers and managers, store operator, super admins → the register's entry page |
| Rejected / cancelled by the office | The guard who made it → the gate's entry page |

## Effects on existing pages

- **Goods Receipt:** the picker above; the list has a **Gate in** column; the
  GRN view and the printed GRN show the entry number, vehicle, driver, in-time
  and challan. `goods_receipt_notes.gate_inward_id` is the link.
- **Gate pass page / Returns & Job Work:** the picker and the "At gate" badge
  above. `gate_pass_receipts.gate_inward_id` is the link
  (`gate_inward_attach_receipt`, called right after `gate_pass_receive`).
- Nothing in stock, consumption closing, accounting, QC or the outward gate
  pass rules changes.

## Not in this phase

Enforcement on by default, the stale morning notification, the PO "At gate"
column, the QC form showing gate entries, the sales-return and loading-vehicle
closings, manual backfill from the paper register and weighbridge weights:
see `docs/GATE_INWARD_PLAN.md`, Phases 2 and 3.
