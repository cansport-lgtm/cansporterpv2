# Admin & Facilities

Sidebar group **Admin & Facilities** (module key `facilities`, routes
`/facilities/...`) for the office administration work: the daily security
camera check, office cleaning inspections, custody of office assets, the admin
store and supply requests, employee SIM cards and the upkeep of office
equipment. Plan and decisions: `docs/ADMIN_FACILITIES_PLAN.md`.

Database: `supabase/migrations/20261110120000_facilities_roles.sql` (roles) and
`20261110120100_facilities_core.sql` (settings, event log, helpers), then one
migration per sub-module (`…120200_facilities_cameras.sql`,
`…120300_facilities_cleaning.sql`, `…120400_facilities_assets.sql`,
`…120500_facilities_supplies.sql`, `…120600_facilities_sims.sql`,
`…120700_facilities_equipment.sql`). Rollbacks with the same names in
`supabase/rollbacks/` (run the sub-modules first, then core, then roles).
Shared code: `src/lib/facilities.ts` and one `src/lib/facilities<Sub>.ts` per
sub-module; pages in `src/pages/facilities/<sub>/`.

Every table is read-only to the app. Every write goes through a
`facilities_*` database function that checks the caller's role with
`facilities_can(action)`; every action is logged in `facilities_events`
(one timeline table, `document_type` + `document_id`) and shown as the
document's timeline.

## Roles (Settings → Users, module "Admin & Facilities")

| Role | Can |
|---|---|
| `facilities_manager` | Everything but Settings: masters, review camera checks, discard drafts, close tickets, stock adjustments, reassign action items, SIM bill notes |
| `facilities_officer` | Fill camera checks and inspections, issue / take back assets, SIMs and supplies, work tickets, raise reorder purchase requests |
| `facilities_viewer` | Read only |
| `facilities_technician` | Only the equipment tickets assigned to them (`/facilities/equipment/tickets`) |
| `cleaning_supervisor` | Only the cleaning action items assigned to them (`/facilities/cleaning/actions`) |
| Department heads | Approve the supply requests of their department (same heads as Purchase Requests) |
| `super_admin` | All of the above and `/facilities/settings` |

`facilities_can('manage')` = super admin + manager; `'operate'` adds the
officer; `'technician'` adds the technician; `'cleaning'` adds the cleaning
supervisor; `'settings'` = super admin.

## Settings (`/facilities/settings`, super admin)

| Setting | Default | Used by |
|---|---|---|
| Camera check alarm time | 11:00 (Pakistan) | Missed-check notification |
| AMC expiry alert | 30 days before | Equipment daily alerts |
| High-priority ticket escalation | 3 days open | Equipment daily alerts |
| SIM bill due day | 10th | SIM bill reminder |

## 1. Camera daily check (`CCK-000001`, …)

Masters on **Cameras & Recorders**: cameras (code, name, zone, recorder and
channel, IP, optional fixed asset, order on the check, active) and recorders
(NVR / DVR: code, name, channels, expected footage days).

**One check per day** (`facilities_camera_checks`, unique on the date).
*Start today's check* makes the draft with a line for every active camera and
every active recorder. On the phone each camera gets a result (OK · Blurry ·
Offline · Damaged · No rec. · Angle), a remark and a photo when it is not OK;
each recorder gets Recording? · footage days · HDD · clock. Lines save as they
are tapped. **Submit** needs every result; it counts, locks the check and —
when the equipment sub-module is installed — creates or re-opens an equipment
ticket per faulty camera (`facilities_ticket_from_camera`). Faults notify the
managers. A manager may **review** a submitted check or **discard** an
abandoned draft.

Every 30 minutes `facilities_camera_check_notify_missed()` (pg_cron
`facilities-camera-check-missed`) tells managers and officers once a day when
no check has been submitted by the alarm time.

The list page shows the month as a calendar (green all ok, amber faults, blue
draft, red missed).

## 2. Cleaning inspections (`CLN-000001`, …)

**Areas & Checklists**: checklist templates with checkpoints (seeded:
Washroom, Office area), and areas (code, name, location, template, frequency
daily / twice daily / weekly on a weekday / monthly on a day, default
cleaning supervisor, active).

**Cleaning Inspections** shows what is due today per area (done / due /
overdue / not due) and the recent inspections. An inspection is one area, one
date, one shift (evening only for twice-daily areas): every checkpoint OK ·
Not OK · N/A with remark; a photo is required on Not OK. Submit computes the
score (OK ÷ applicable) and makes one **action item** per Not OK line for the
area's supervisor, due the next day. Supervisors close their items with an
"after" photo and a note (**Cleaning Action Items**); managers may reassign.
An action item that is really an equipment fault opens a pre-filled
equipment ticket. Scores below 70 notify the managers; a 09:00 cron
(`facilities-cleaning-overdue`) reports overdue areas.

## 3. Asset custody (`AST-000001`, …)

Reads the office assets from **Fixed Assets → Asset Register** (category
Office Assets, not disposed). Nothing about the asset itself changes here.
`v_facilities_asset_custody` gives each asset's current holder, condition,
accessories and last verification from the movements. A movement is an
**issue** (store → employee), **return** (employee → store), **transfer**
(employee → employee) or **verify** (physical verification, holder
unchanged). The receiving employee acknowledges on **My Assets & SIM**; the
officer may mark it signed on paper.

**Employee Clearance** lists what an employee still holds (office assets and
SIMs) and says clear / not clear — for HR when someone leaves.

## 4. Admin store and supply requests (`SR-000001`, …)

The **admin store** holds consumables from the item master (category Office
Supplies): on hand, reorder level, reorder quantity, location, with a ledger
(opening, adjustment, issue, receipt). Quantities are tracked.

```
employee raises SR (Self Service → My Supply Requests) → submit → with department head
  → head approves (may lower quantities; every request needs this)
  → officer issues from the store (issued ≤ approved and ≤ on hand) → stock reduced
  → employee acknowledges
rejected by the head (reason) · cancelled by the requester before issue or by a manager
```

Department heads are the same as for Purchase Requests
(`purchase_request_department_heads`); a head raising their own request is
approved automatically. The **Shortage** tab lists items at or below their
reorder level; **Raise purchase request** makes a normal `PRQ-` of category
Office Supplies through `purchase_request_save` and hands it to the existing
purchase flow. Receipts post with `facilities_store_receive` (the GRN hook is
a later step; until then the officer records receipts as adjustments).

## 5. SIM register (`SIM-000001`, … for movements)

**SIM Register**: number, network, package and cost, monthly limit, type,
status (in stock · issued · suspended · lost · closed), holder, handset
(optional office asset), ICCID / PUK (managers only). Issue / return / status
changes are movements; an issue tells the employee (My Assets & SIM).

**SIM Bills**: one bill run per network per month. Start → one line per
issued / suspended SIM pre-filled with the package cost → enter the amounts →
**Post**. Over-limit = amount − limit per line. **The company bears the
bill**: over-limit lines are only flagged, a manager may add a note, and the
managers are told the count and total. The *Over-limit report* tab shows the
last 6 months per number. A daily cron (`facilities-sim-bill-reminder`)
reminds on the due day when last month's bill is missing.

## 6. Equipment and tickets (`EQT-000001`, …)

**Equipment Register**: office equipment (AC, generator, UPS, printer, water
dispenser, CCTV, fire extinguisher, lift, network, other) with location,
optional fixed asset, vendor and AMC (dates), service interval in days or
running hours, last service, run hours. `v_facilities_equipment_due` computes
next due and the AMC state. Production machines stay in Maintenance.

**Equipment Tickets**: anyone reports a fault (Self Service → Report a
Fault, or from a camera check / cleaning action item):

```
open → assigned (officer: a technician or a vendor) → in progress → done (action taken, parts, cost, paid through, reference) → closed (manager)
reopen with a reason
```

Technicians see only their own tickets. A preventive **service ticket** is
made from the register with the type's checklist. A 03:30 UTC cron
(`facilities-equipment-alerts`) tells managers about AMCs expiring, services
overdue and high-priority tickets open beyond the escalation days.

## Self service (every logged-in user)

| Page | Route |
|---|---|
| My Supply Requests (raise, follow; heads approve) | `/my-supply-requests` |
| My Assets & SIM (what I hold, acknowledge) | `/my-assets` |
| Report a Fault | `/report-fault` |

## Notifications (module `facilities`)

| When | Who |
|---|---|
| Camera check submitted with faults; check missed by the alarm time | Managers (+ officers for missed) |
| Inspection submitted with Not OK lines | The area's supervisor; managers when the score < 70 or no supervisor |
| Areas overdue (09:00) | Managers and officers |
| Asset or SIM issued | The employee (acknowledge) |
| Supply request submitted / approved / issued / rejected | Heads / officers and requester / requester |
| SIM bill posted; bill missing on the due day | Managers |
| Ticket created / assigned / done; AMC, service or escalation alerts | Managers and officers / assignee / managers |
