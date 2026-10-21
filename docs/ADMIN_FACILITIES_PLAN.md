# Admin & Facilities — plan (decisions confirmed 21 Oct 2026, mockup only, nothing built yet)

A new sidebar group **Admin & Facilities** (module key `facilities`, routes
`/facilities/...`) for the office administration work that today happens on
paper or WhatsApp: the daily security camera check, office cleaning
inspections, custody of office assets, office supply requests from an admin
store, employee SIM cards and the upkeep of office equipment (ACs, generators,
UPS, printers, fire extinguishers).

Mock: `docs/mockups/admin-facilities-mockup.html` (open in a browser; every
screen below is a tab in it).

The module follows the Purchase Requests / Store Pass conventions exactly:
own number series per document, tables read-only to the app, every write
through role-checked `facilities_*` database functions, an event log per
document, rollback script, a doc in `docs/` when it goes live.

---

## 1. What it connects to (nothing is duplicated)

| Area | Existing thing we build on | How |
|---|---|---|
| Office assets | `fixed_assets` (category `office_assets`), QR labels, Reconciliation | **Custody** (who holds which asset) is new; the asset itself stays in the Fixed Asset register. Issuing an asset never changes its value or status |
| Cameras / equipment | `fixed_assets` | Each camera and each piece of office equipment can point at a fixed asset (`fixed_asset_id`, optional) so warranty, purchase price and disposal stay in one place |
| Office supplies | Purchase Requests (`PRQ-`, category `office_supplies`), `items` master, GRN | Employees ask the **admin store** (new, small stock). When stock is below its reorder level, the admin officer raises a normal purchase request pre-filled from the shortage. A GRN for an office-supplies item posts the quantity into the admin store |
| SIM bills | Expenses → Utility Bills / General Expenses | Monthly SIM bill is entered once and posts to Expenses; over-limit is reported, not deducted |
| Equipment faults | Help Desk pattern (`helpdesk_tickets`) and production `maintenance_work_orders` | Office equipment tickets are a **separate** table (confirmed) (different asset base, different people) but the same shape: ticket number, priority, assigned to, resolution, timeline. Production machines stay in Maintenance |
| Cleaning inspection | 5S Audit (`five_s_checkpoints`, `five_s_audits`, responses, action items) | Same checkpoint → run → response → action item shape, with areas instead of departments and photo per failed point |
| Employees | `employees` | Custody, SIMs, clearance on exit |
| Alerts | `notify_user` / `notify_role`, System Notifications | Missed camera check, overdue inspections, AMC expiry, SIM over limit |

## 2. Sub-modules

### 2.1 Security cameras — daily check

| | |
|---|---|
| Masters | **Cameras**: code (`CAM-01`), name, zone (Gate, Store, Floor A, Office, Parking…), NVR/DVR and channel number, IP (optional), fixed asset (optional), active flag. **Recorders** (NVR/DVR): name, channels, retention days expected |
| Document | **Daily check** `CCK-000001`, **once a day** (unique on date, confirmed). Lines are generated from all active cameras |
| Line result | `ok` · `blurry` · `offline` · `damaged` · `no_recording` · `wrong_angle`, remark, optional photo |
| Recorder part | Per NVR: recording OK yes/no, days of footage available, HDD status, date/time correct, remark |
| Flow | `draft` (guard/admin officer fills on phone) → `submitted` (locked; summary counts) → optional `reviewed` by admin manager |
| Automation | Any line not `ok` creates one **equipment ticket** (2.6) for that camera, or re-opens the existing open one, so the fault is tracked to repair. 11:00 daily: if no check submitted for today → notify `facilities_manager` and `super_admin` |
| Reports | Calendar view (green/amber/red per day), camera fault history, cameras most often faulty |

### 2.2 Office cleaning inspection

| | |
|---|---|
| Masters | **Areas** (Reception, Washroom M/F ground, Pantry, MD office, Meeting room, Stairs, Prayer area, Parking…), **Checklist templates** per area type with checkpoints (floor swept & mopped, bins emptied, soap & tissue stocked, mirrors clean, no odour, AC filters…), **Frequency** per area: daily / weekly / monthly |
| Document | **Inspection** `CLN-000001`: date, shift (morning/evening), area, inspector, lines = template checkpoints |
| Line result | `ok` · `not_ok` · `na`, remark, photo (required on `not_ok`) |
| Score | % ok of applicable; area status colour on the dashboard |
| Flow | `draft` → `submitted`. `not_ok` lines create **action items** assigned to the cleaning supervisor with a due date; closing needs an "after" photo |
| Schedule | Due list generated from area frequency; dashboard shows "due today / overdue / done" per area |
| Reports | Area score trend (weekly), repeat failures by checkpoint, supervisor action closure time |

### 2.3 Office asset custody (connected to Fixed Assets)

| | |
|---|---|
| Source | `fixed_assets` where category = `office_assets` and status = `active` (laptops, phones, furniture, printers, AC units…) |
| Document | **Asset issue / return / transfer** `AST-000001`: asset, from (store or employee), to (employee or store), date, condition (`new`/`good`/`fair`/`damaged`), accessories (charger, bag…), remark, acknowledgement (employee signs on phone or admin ticks "signed on paper") |
| Views | **Custody register**: every office asset with its current holder, location, condition, last verified. **Employee view**: everything an employee holds (used by HR on exit). **Unassigned**: in admin store |
| Clearance | **Employee clearance** check: when HR marks an employee as leaving, the module lists the assets and SIMs still with them; HR cannot complete clearance until all are returned or written off (phase 2 link, HR side is a small banner) |
| Verification | Periodic **physical verification**: scan the QR label (existing `QRScannerDialog`) → confirms holder and condition; feeds Fixed Assets → Reconciliation |

### 2.4 Office supply requests (connected to Purchase)

| | |
|---|---|
| Admin store | **Quantities are tracked** (confirmed). Small stock of consumables: items from the `items` master, category `office_supplies` (stationery, toner, tea/sugar, cleaning material, water bottles). Per item: on hand, reorder level, reorder qty, location |
| Document | **Supply request** `SR-000001` by any employee (Self Service → My Supply Requests): department, lines (item, qty), reason. Approval: **department head on every request** (confirmed; reuse `purchase_request` department-head logic, head may lower quantities). Then admin issues: issued qty ≤ approved qty, stock reduced, employee acknowledges |
| Stock in | GRN of an office-supplies purchase order posts to the admin store (trigger on GRN confirm, phase 2). Manual "opening stock" and "adjustment" entries with reason by `facilities_manager` |
| Reorder | **Shortage list**: items at or below reorder level. One click → new purchase request (`PRQ-`, category `office_supplies`) pre-filled with reorder quantities, handed to the existing purchase flow |
| Reports | Consumption by department per month (cost from item unit price), top items, request turnaround |

### 2.5 Employee SIM management

| | |
|---|---|
| Register | **SIMs**: number, network (Jazz, Zong, Telenor, Ufone), package name, monthly package cost, monthly limit (PKR), type (voice/data/device), status (`in_stock`, `issued`, `suspended`, `lost`, `closed`), PUK/ICCID (visible to admin only) |
| Document | **SIM issue / return** `SIM-000001`: SIM, employee, date, handset (optional link to an office asset), acknowledgement. One SIM has one holder at a time |
| Monthly bill | **Bill run** per network per month: upload / enter amount per number. Over-limit = amount − limit. **The company bears the bill** (confirmed): no salary deduction. Over-limit lines are only flagged with an optional note, and a monthly over-limit report goes to the facilities manager. Bill total posts to Expenses → Utility Bills |
| Alerts | Bill not entered by the 10th; same number over limit 3 months running; SIM with no holder but status issued; employee leaving with a SIM (clearance) |

### 2.6 Office equipment maintenance

| | |
|---|---|
| Register | **Equipment**: code, name, type (AC, generator, UPS, printer, water dispenser, CCTV, fire extinguisher, lift, server/network), location, fixed asset (optional), vendor / AMC contract, AMC expiry, service interval (days or running hours for generators), last service date, next due (computed) |
| Document | **Ticket** `EQT-000001`: equipment, reported by (anyone, from Self Service → Report a Fault), fault description, photo, priority. Flow `open` → `assigned` (internal person or vendor) → `in_progress` → `done` (action taken, parts, cost, invoice/petty-cash reference) → `closed` by admin manager. Reopen allowed |
| Service plan | **Service calendar** from the intervals: due this week / overdue. Doing a service creates a ticket of type `preventive` with the checklist for that equipment type (AC: filter wash, gas pressure…; extinguisher: pressure gauge, refill date) |
| Cost | Cost per ticket; monthly cost by equipment type; cost per equipment vs its current value (hint to replace) |
| Alerts | AMC expiring in 30 days, service overdue, ticket open > 3 days at `high` priority |

### 2.7 Later candidates ("etc.")

Not in this plan, listed so they can be slotted in later: visitor log at the
gate (Guard already exists), vehicle register and pool-car booking (sales fuel
already covers trips), office key register, courier in/out register, utility
meter readings (electricity/gas/water units per day), generator fuel log.

## 3. Pages (sidebar group **Admin & Facilities**)

| Page | Route | Who |
|---|---|---|
| Dashboard | `/facilities/dashboard` | module users |
| Camera Daily Check | `/facilities/cameras/checks`, `/facilities/cameras/checks/:id` | officer fills, manager reviews |
| Cameras & Recorders (master) | `/facilities/cameras` | manager |
| Cleaning Inspections | `/facilities/cleaning`, `/facilities/cleaning/:id` | officer / inspector |
| Cleaning Action Items | `/facilities/cleaning/actions` | supervisor, manager |
| Areas & Checklists (master) | `/facilities/cleaning/setup` | manager |
| Asset Custody | `/facilities/assets`, `/facilities/assets/:id` (movement) | officer, manager |
| Admin Store & Supply Requests | `/facilities/supplies`, `/facilities/supplies/stock`, `/facilities/supplies/:id` | officer, manager |
| SIM Register & Bills | `/facilities/sims`, `/facilities/sims/bills` | officer, manager |
| Equipment & Tickets | `/facilities/equipment`, `/facilities/equipment/tickets`, `/facilities/equipment/tickets/:id` | officer, manager, technician |
| Settings | `/facilities/settings` | super admin |
| **Self Service** (existing group) | `/my-supply-requests`, `/my-assets` (what I hold), `/report-fault` | every logged-in user |

Phone first for the three "walk-around" pages: camera check, cleaning
inspection, physical verification (same approach as the Store Pass and Guard
pages: big tap targets, camera upload, works offline-tolerant with draft save).

## 4. Roles

| Role | Can |
|---|---|
| `facilities_manager` | Everything in the module except settings: masters, review checks, close tickets, approve stock adjustments, SIM bill decisions |
| `facilities_officer` | Fill camera checks and inspections, issue/return assets and SIMs, issue supplies, work tickets, raise purchase requests for the admin store |
| `facilities_technician` | Sees and updates tickets assigned to them only |
| `cleaning_supervisor` | Cleaning action items assigned to them (close with photo) |
| Department heads | Approve supply requests of their department (existing head logic) |
| `super_admin` | All of the above + Settings |

Module key `facilities` is added to `MODULE_ROLE_MAP` in `AuthContext.tsx`
(`rolePrefix: 'facilities'`), so Settings → Users shows it like other modules.

## 5. Database (all new tables `facilities_*`, app has SELECT only)

```
facilities_cameras, facilities_recorders
facilities_camera_checks (one per date) + _lines + _recorder_lines
facilities_areas, facilities_checklists, facilities_checkpoints
facilities_inspections + _lines, facilities_action_items
facilities_asset_movements          (fixed_asset_id, from/to employee, condition, ack)
facilities_asset_custody (view)      current holder per asset = last movement
facilities_store_items (item_id, on_hand, reorder_level, reorder_qty)
facilities_store_ledger (in/out/adjust, ref to SR / GRN / adjustment)
facilities_supply_requests + _lines
facilities_sims, facilities_sim_movements, facilities_sim_bills + _lines
facilities_equipment, facilities_equipment_types (+ service checklist)
facilities_tickets + _comments
facilities_events  (one timeline table, document_type + document_id)
facilities_settings (missed-check alarm time, free quantities, AMC alert days…)
```

Functions (SECURITY DEFINER, role-checked): `facilities_camera_check_start /
_save_line / _submit / _review`, `facilities_inspection_*`,
`facilities_asset_move`, `facilities_supply_request_submit / _approve /
_issue`, `facilities_store_adjust`, `facilities_store_reorder_to_prq`
(creates the `PRQ-` via the existing `purchase_request_*` functions),
`facilities_sim_move`, `facilities_sim_bill_post`, `facilities_ticket_*`.

Triggers: camera line not ok → ticket; GRN confirmed for office-supplies
lines → store ledger in (phase 2); employee status → leaving → clearance
notification.

Daily cron (pg_cron, like the 20:30 store reconciliation): 11:00 missed
camera check; 09:00 inspections due / overdue; 1st of month SIM bill
reminder; daily AMC / service due.

## 6. Frontend files

```
src/pages/facilities/        Dashboard, CameraChecksPage, CameraCheckPage (phone), CamerasPage,
                             CleaningInspectionsPage, CleaningInspectionPage (phone), CleaningActionsPage,
                             CleaningSetupPage, AssetCustodyPage, AssetMovementDialog,
                             AdminStorePage, SupplyRequestsPage, SupplyRequestPage,
                             SimsPage, SimBillsPage, EquipmentPage, EquipmentTicketsPage,
                             EquipmentTicketPage, FacilitiesSettingsPage
src/pages/self-service/      MySupplyRequestsPage, MyAssetsPage, ReportFaultPage
src/components/facilities/   ResultToggle (ok/not ok/na), PhotoCapture (reuse store-pass upload),
                             TimelineCard (reuse purchase request timeline), QR scan (reuse fixed-assets)
src/lib/facilities.ts        types, status labels, number formats
src/components/layout/ERPSidebar.tsx   new group; Self Service entries
src/App.tsx                  routes
```

## 7. Delivery in four steps

| Step | Contains | Why first |
|---|---|---|
| **1** | Module, roles, dashboard, **camera daily check**, **cleaning inspection** + action items, masters, missed-check / overdue alerts | Pure new data, no other module touched, immediate daily use |
| **2** | **Asset custody** on Fixed Assets, **admin store + supply requests**, reorder → purchase request | Touches Fixed Assets (read) and Purchase (creates PRQ through existing functions) |
| **3** | **SIM register + monthly bills**, over-limit report, employee clearance banner in HR | Touches Expenses and HR (read) |
| **4** | **Equipment register, tickets, service calendar, AMC alerts**; camera fault → ticket switched on | Reuses step-1 masters; closes the loop |

Each step ships with its migration, rollback, doc and sidebar entries;
steps 1 and 2 are the first PR candidates.

## 8. Decisions

Confirmed 21 Oct 2026:

| # | Question | Decision |
|---|---|---|
| 1 | Camera check frequency | **Once a day** |
| 2 | Supply request approval | **Department head approves every request** |
| 3 | Admin store | **Quantities tracked** (on hand, reorder level, ledger) |
| 4 | SIM over-limit | **Company bears**; over-limit only reported |
| 5 | Equipment tickets | **Separate** from production Maintenance |

Still open (can be settled when step 1 starts):

1. **Who does the camera check** — the gate guard (existing `guard` role, guard phone layout) or an admin officer. The mockup works for either; it only decides which layout the page opens in.
2. **AMC vendors**: use `suppliers` from Purchase (proposed) or free text on the equipment.
3. Which "etc." items from 2.7 come next (visitor log, vehicle booking, key register, courier register, utility meter readings, generator fuel log).
