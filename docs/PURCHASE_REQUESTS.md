# Purchase Requests (any department asks Purchase to buy)

A **purchase request** is how a department asks Purchase to buy items. One
number series: `PRQ-000001`, `PRQ-000002`, … given only when a request saves
successfully (Production Requirements already use `PR-YY-NNNN`).

Database: `supabase/migrations/20261016130000_purchase_requests.sql`.
Rollback in `supabase/rollbacks/20261016130000_purchase_requests_down.sql`.
Shared code: `src/lib/purchaseRequest.ts`, category names in
`src/lib/purchase/categories.ts`.

## Categories

The four existing purchase categories. Two of them got new display names
everywhere in the app; the database values are unchanged, so items,
suppliers, purchase orders, GRNs and accounting keep working as before.

| Database value | Shown as | Extra on the request |
|---|---|---|
| `office_supplies` | Office Supplies | — |
| `raw_material` | Raw Material | Job order / production requirement (optional, free text) |
| `general_supplies` | **Production Supplies** (gloves, clippers, …) | — |
| `spare_maintenance` | **Spares & Parts** | Machine (optional), **breakdown** tick, which makes it urgent |

Every line is an item from the **item master** of the request's category
(no free-text items). An item can appear once per request. A missing item is
added on Master Data → Items first.

## Flow

```
Requester saves a draft → Submit → With department head
  → department head approves → With Purchase
  → Purchase approves
       estimated value ≤ approval limit → Approved (ready to order)
       estimated value  > approval limit → Final approval → super admin approves → Approved
Rejected at any approval step (reason required) · Cancelled (see below)
```

- **Department head step is skipped** when the requester is a head of the
  request's department (logged as passed automatically).
- **A department without a head cannot submit** requests: the submit fails
  with a message asking a super admin to set one.
- **Quantities**: each approver may lower a line's quantity (0 drops the line)
  but never raise it above what was requested. If every line is 0, reject instead.
- **Estimated value** = Σ approved quantity × estimated rate. The rate starts as
  the item's unit price in the item master; the Purchase approver can change it.
- **Cancel**: the requester, before the request is approved (a draft without a
  reason, otherwise with one); a purchase manager or super admin, any time
  before it is ordered.
- `partially_ordered` / `ordered` are reserved for the next step (raising
  purchase orders from approved requests).

## Who does what

| Step | Who |
|---|---|
| Raise, edit own draft, submit | **Any logged-in user** (Self Service → My Purchase Requests) |
| Department head approval | Users set as **heads of that department** (any role); super admin may act for any department |
| Purchase approval | The category's **Approver** role (below), `purchase_manager`, super admin, or a user with *approve* on that category in `purchase_category_permissions`. **Never on their own request** (super admin excepted) |
| Final approval (above the limit) | **Super admin** only |
| Settings: approval limit, department heads | **Super admin** only |

The department is the requester's own department (from their login, `app_users.department_id`,
the production departments list); they can pick another one on the form, and that
department's heads then approve.

Every write goes through the `purchase_request_*` database functions, which
check these rules; the tables are read-only to the app. Every action is logged
in `purchase_request_events` and shown as the request's timeline.

### Roles per category

Two roles for each category, given on **Settings → Users**
(`20261016130100_purchase_request_roles.sql`, rights in
`20261016130200_purchase_request_role_rights.sql`):

| Category | Officer | Approver |
|---|---|---|
| Office Supplies | `pr_office_officer` | `pr_office_approver` |
| Raw Material | `pr_raw_material_officer` | `pr_raw_material_approver` |
| Production Supplies | `pr_production_officer` | `pr_production_approver` |
| Spares & Parts | `pr_spares_officer` | `pr_spares_approver` |

- **Officer**: opens Purchase → Purchase Requests and sees only its
  category's requests (no other Purchase page); told when one is approved and
  ready to order.
- **Approver**: the officer's rights, plus the Purchase approval for its
  category (lower quantities, set estimated rates, approve / reject); told when
  one waits for Purchase.
- A user can hold several (for example the spares approver and the production
  officer). Their categories add up.
- Purchase managers, purchase officers and accounting officers keep seeing
  every category; anyone can still raise requests on My Purchase Requests.

## Pages

| Page | Route | What it shows |
|---|---|---|
| My Purchase Requests | `/my-purchase-requests` | Own requests; **To approve** tab for department heads |
| New / edit draft | `/my-purchase-requests/new`, `/my-purchase-requests/:id/edit` | Category, department, priority, required-by date, purpose, category extras, item lines |
| Request page | `/my-purchase-requests/:id`, `/purchase/requests/:id` | Items, status, approval panel for whoever's turn it is, timeline, print, cancel |
| Purchase Requests | `/purchase/requests` | Counts; tabs **To approve** (your categories), **Final approval**, **Approved — to order**, **All** (date range); filters; Excel export; **Settings** (super admin) |

The printed slip shows the request, the items with requested and approved
quantities, and signature lines for requester, department head, Purchase and
(when needed) final approval. Rates and values appear only for users who may see
prices.

## Notifications

| When | Who is told |
|---|---|
| Submitted | The department's heads (or Purchase, when the head raised it) |
| Department head approved | Requester; purchase managers and the category's approvers (Approver role or category permission) |
| Purchase approved, above the limit | Super admins; requester |
| Approved | Requester; purchase officers and managers, and the category's Officer and Approver roles (ready to order) |
| Rejected / cancelled | Requester (and Purchase, when rejected at final approval) |

## Settings

Purchase → Purchase Requests → **Settings** (super admin):

- **Approval limit** (default 100,000). A request above it needs the super
  admin's final approval after Purchase.
- **Department heads**: one or more users per department.

## Next steps (not built yet)

- Raise purchase orders from approved request lines, track ordered quantity and
  move requests to Partly ordered / Ordered.
- Show the request number on the PO and the GRN.
- Suggested requests from items below their reorder level.
