# Private Label Job Orders — Floor Priority Sequence (Plan)

Status: **proposed, not built.**

## Goal

The floor display (`/floor/private-label`) today sorts issued orders by the
low / medium / high / critical **priority** label, then required-by date. That
gives ties and the floor still has to guess which order to pick up first.

This adds an explicit **floor sequence**: a numbered queue (1, 2, 3 …) of the
issued orders, set by the people who issue private label job orders. The floor
tiles show the number and are listed in that order, so the floor always knows
what is next.

## How it should work

### Where the sequence lives

- One new column on the existing header table, `private_label_job_orders.floor_sequence integer NULL`.
  No new table: the sequence is a property of an issued order, and the floor
  already reads this table through `pljo_floor_orders()`.
- The sequence is meaningful only while the order is **Issued**. Draft orders
  have no number. Close / Cancel clears it.
- **One queue for the whole floor**, across private label and company product
  orders (both live in this table with `order_type`). The floor has one set of
  people and one "what next" question; the type tabs on the floor page still
  filter, and the numbers stay the same on every tab. *(Decision to confirm —
  a per-type queue is a one-line change in the function and trigger below.)*

### Lifecycle (database triggers, no UI code needed)

| Event | What happens to `floor_sequence` |
|---|---|
| Draft → Issued | Appended to the end of the queue: `max(floor_sequence) + 1` over issued orders. A new order never jumps ahead unless someone moves it. |
| Issued → Closed / Cancelled | Set to NULL and the remaining issued orders are **compacted** (1..N, no gaps), so the floor never shows "1, 2, 5". |
| Floor marks "production done" | Keeps its number. The floor page already hides done orders unless "show done" is on; done orders list after the live ones. |
| Floor "Reopen" | Keeps its number (it is still Issued). |

Compaction and append happen inside the existing `pljo_guard_header` /
status trigger path, in one transaction, so two people issuing at the same
moment cannot get the same number.

### Who can set the sequence

Reordering is done through **one RPC**, `pljo_set_floor_sequence(p_order_ids uuid[])`,
`SECURITY DEFINER`, which:

1. Resolves the caller with `app_user_id()` and refuses unless they hold a role
   that can **issue** a private label job order today — the planning module
   roles: `super_admin`, `admin`, `manager`, `production_operator`,
   `closing_data_poster` (see `docs/PRIVATE_LABEL_JOB_ORDERS.md`, "Who can
   act"). Checked with the existing `has_role()`, the same way
   `pljo_floor_set_pin` checks for `super_admin`. The exact list is read from
   `ROLE_MODULE_ACCESS` in `AuthContext.tsx` at build time and must match it.
   *(The production operator's 48-hour edit window is not applied here:
   sequencing is a floor-scheduling act, not an edit of the order.)*
2. Requires `p_order_ids` to be **exactly** the set of currently issued orders
   (no missing, no extra, no duplicates); otherwise it raises. This means the
   client always sends the complete queue and the server rewrites
   `floor_sequence = 1..N` in array order. No unique constraint is needed and
   there is no two-step "swap" problem.
3. Writes one log row per order whose number changed:
   `action = 'sequenced'`, details `"Floor sequence: 3 → 1"`. The
   `private_label_job_order_log.action` CHECK gains `'sequenced'`.
4. Goes through the central audit log as the existing triggers already do
   (`audit_row_change('planning')`), so no extra audit work.

The floor PIN functions (`pljo_floor_*`) **never** write `floor_sequence`.
The floor only reads it.

### Floor display

`pljo_floor_orders()` adds `floor_sequence` to each row and orders by
`floor_sequence NULLS LAST, priority_rank, required_by_date NULLS LAST, pl_job_order_number`
(the old order stays as a fallback for the brief moment between a deploy and
the backfill, and for anything that somehow has no number).

On the page (`PrivateLabelFloorPage.tsx`):

- **Big sequence badge** on every tile, top-left, e.g. a `#3` chip in the same
  size as the "New" badge, so it reads from across the floor.
- **Order of tiles = sequence.** Today the page re-sorts by update-clock state
  (overdue first). Change that so sequence is the primary order and the
  update-clock state only drives the red / amber styling, the "Update overdue"
  count tile and the siren — all of which stay as they are. *(Decision to
  confirm: if you would rather keep overdue tiles jumping to the front, keep
  the current sort and the badge still shows the number.)*
- **"Next up"** highlight on the first tile that is not production-done
  (a thicker border and a small "NEXT" label) so the floor does not have to
  read numbers at all for the common case.
- Done orders keep their badge but, as now, drop below the live ones.
- No new fetch: the page already polls every 15 seconds, so a reorder in
  planning shows on the floor within that time.

### Planning side (where the sequence is set)

On `/planning/private-label-job-orders` (`PrivateLabelJobOrdersPage.tsx`):

- A **"Floor sequence"** button in the toolbar, shown only to users who can
  create/edit on the page (`hasModulePermission('planning', 'edit')`), the
  same guard the Save & Issue button effectively has today.
- It opens a new dialog, `PrivateLabelFloorSequenceDialog.tsx`, listing every
  Issued order (both types, with the type chip the list already uses) in
  current sequence: number, PLJO number, customer / "Company products", grade,
  required-by, done %, and an "Overdue update" marker where the floor clock
  is red.
- Reordering with **Move to top / Up / Down / Move to bottom** buttons per row.
  No drag-and-drop: nothing in `package.json` provides it, and buttons work on
  the touch screens the planners use. Drag-and-drop can be added later
  without changing the RPC.
- **Save** sends the whole list to `pljo_set_floor_sequence`. On a conflict
  error ("queue changed, reload") the dialog refetches and shows the new list
  rather than silently overwriting someone else's change.
- The orders list gets a small **"Seq"** column for Issued rows, and the order
  detail dialog shows "Floor sequence: 3" in its header while Issued. The log
  tab shows the `sequenced` entries like any other.
- The job order print is unchanged (the number is a live queue position, not
  part of the order).

### Backfill (same migration)

Give every currently issued order a number once, in today's floor order:
priority rank, then required-by date, then PLJO number. From then on the
triggers maintain it.

## Files

| Change | File |
|---|---|
| Migration: column, backfill, trigger changes, `pljo_set_floor_sequence`, `pljo_floor_orders` v4, log action | `supabase/migrations/2026XXXXXXXXXX_private_label_floor_sequence.sql` |
| Rollback | `supabase/rollbacks/2026XXXXXXXXXX_private_label_floor_sequence_down.sql` |
| Generated types | `src/integrations/supabase/types.ts` |
| `FloorOrder.floor_sequence`, `PljoOrder.floor_sequence`, `setFloorSequence()` client call | `src/lib/privateLabelJobOrder.ts` |
| Badge, sort, "Next up" | `src/pages/planning/PrivateLabelFloorPage.tsx` |
| Toolbar button, Seq column | `src/pages/planning/PrivateLabelJobOrdersPage.tsx` |
| New reorder dialog | `src/components/planning/PrivateLabelFloorSequenceDialog.tsx` |
| Header shows sequence | `src/components/planning/PrivateLabelJobOrderDialog.tsx` |
| Docs | `docs/PRIVATE_LABEL_JOB_ORDERS.md` (new "Floor sequence" section) |

Company job orders share every one of these (same table, same floor page), so
nothing separate is needed for `CompanyJobOrdersPage.tsx` beyond the Seq
column if wanted.

## Not changed

- Normal job orders (`job_orders`, `/planning/job-orders`) are untouched.
- The existing `priority` field stays. It is still a label on the form and
  the print, and it is the fallback order for anything without a sequence.
  It no longer decides tile order on the floor on its own.
- The floor PIN, progress, check-in, done and the 2-hour update alarm are
  unchanged.

## Decisions to confirm before building

1. One queue across private label **and** company product orders (recommended), or one per type?
2. On the floor, is the sequence the primary order, with overdue-update orders only highlighted (recommended), or should overdue orders still jump to the top?
3. Should `priority` stay as a separate field (recommended, nothing to migrate), or be dropped from the form now that the sequence exists?
4. Who may reorder: the planning roles listed above, or only `super_admin` / `admin` / `manager`?

## Rough effort

Migration + rollback: half a day. Floor page + planning dialog + list column:
one day. Docs and type regeneration: an hour. Total about two working days,
one migration, no new tables.
