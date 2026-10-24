# Private Label Job Orders

Production Planning → **Private Label Job Orders** (`/planning/private-label-job-orders`).

A separate job order form for private-label work. Each order covers **one customer and one grade (ball)**. Each line is a **size** with its color, quantity and packing. Every change is kept in a **log**.

Database: `supabase/migrations/20261024120000_private_label_job_orders.sql`.
Rollback: `supabase/rollbacks/20261024120000_private_label_job_orders_down.sql`.
Code:
- `src/lib/privateLabelJobOrder.ts` (logic)
- `src/lib/privateLabelJobOrderPrint.ts` (printed form)
- `src/pages/planning/PrivateLabelJobOrdersPage.tsx` (list page)
- `src/components/planning/PrivateLabel*.tsx` (form, log, sizes)

## Separate from normal Job Orders

- It has its own tables (`private_label_*`) and its own number series, **`PLJO-YY-NNNN`**.
- Normal job orders (`JO-YY-NNNN`, `/planning/job-orders`) are unchanged. Nothing else in the app reads these tables.
- The grades, packing types, items and customer logos lists are only read, never changed.
- Each year has a counter that is bumped in a single atomic step. Two people saving at once never get the same number. A failed save doesn't use up a number.

## The form

| Field | Source | Required |
|---|---|---|
| Customer (brand owner) | Customers master | yes |
| Billing customer (who is invoiced) | Customers master; **Same as customer** is ticked by default | yes |
| Grade (ball) | Grades master, one per order | yes |
| Brand name, customer PO / ref, required-by, priority, remarks | typed | no |
| **Logo** | uploaded file (PNG, JPG, SVG, WEBP or PDF, up to 10 MB), or one of the customer's logos from Customer Logos | to issue |
| Artwork / other files | uploaded | no |
| Lines: **Size** | Size list (**Sizes** button on the page) | yes |
| Lines: **Color** | Color list (**Colors** button on the page): Peach, Golden, Standard Yellow to start | yes |
| Lines: Qty (dozens) | typed | yes |
| Lines: **Packing** | Packing Master (`packing_types`, e.g. "12 Dz CTN") | yes |

Master packing and packs per master were removed from the form
(`supabase/migrations/20261028120000_private_label_colors.sql`). The columns
stay in the database as optional, so lines saved before keep their values.
Lines saved before colors existed have no color.

### Logo handling
- **Copied when picked.** A logo picked from Customer Logos is copied into the order. Changing or deleting the customer's logo later doesn't change an order that has already been issued.
- **Storage.** Files live in the public storage bucket `private-label-logos`, under `pljo/<order id>/`.

### Size list
- Sizes are switched off, never deleted, so old orders still show their size.
- A switched-off size stays on the orders that use it, but can't be picked for new lines.

## Status

```
Draft ──Save & Issue──▶ Issued ──Dispatch──▶ Dispatched
  │                       │
  │                       ├──Close─────────▶ Closed
  │                       │
  └──────Cancel (reason)──┴────────────────▶ Cancelled
```

The database enforces these rules, so no screen can get around them:

- **Draft:** everything can be edited. A Draft can be deleted; its number is not reused.
- **Issue:** needs at least one line and a logo.
- **Issued:** only remarks can change. It can be dispatched, closed or cancelled.
- **Dispatched, Closed and Cancelled:** final, nothing can change. See "Dispatch" below.
- **Who can act:** the same people as Job Orders (the `planning` module). A production operator who is not a super admin can edit only within 48 hours of creating the order.

## Log

Each order has a **Log** tab with the time, the user and what changed. Every entry is written automatically by the database:

| Entry | Written when |
|---|---|
| Created | The order is first saved (records the full header) |
| Edited | Header fields change (old → new) |
| Issued, Dispatched, Closed, Cancelled | The status changes (Dispatched carries the dispatch note) |
| Line added / changed / removed | A line changes (with size, color, qty and packing) |
| Logo uploaded / removed, Artwork uploaded / removed | A file is added or removed |
| Printed | The form is printed (via `pljo_log_printed`) |
| Floor sequence set | The order's position on the floor queue changes (old → new, via `pljo_set_floor_sequence`) |

- **Can't be edited.** The log can't be changed or deleted from the app.
- **Audit Log too.** All changes also appear in the central Audit Log under module `planning`.
- **Deleting a Draft deletes its log.** The central Audit Log still records the deletion.

## Printed form

One A4 page per order, printed with the iframe `printDocument()` helper. It shows:
- the company header, the **PLJO number**, dates, priority and status,
- the customer, brand and PO, the **grade**,
- the **logo**,
- the sizes table with color, qty and packing, plus the total dozens,
- remarks and signature boxes.

Printing is available once an order is issued.

## Billing customer

Added in `supabase/migrations/20261027120000_private_label_billing_customer.sql`
(rollback in `supabase/rollbacks/`).

- **Default.** An order with no billing customer, including every order made before this change, is billed to its customer.
- **Locked when Issued.** It can't change once the order is issued. Changes before that go in the log as "Billing customer: old → new".
- **Where it shows.** The office list shows "Bill to" when it differs from the customer. The printed form, the floor page cards and floor prints always show it.
- **Customer lookups now name the link.** The orders table links to `customers` twice, so lookups through the API must say which link they mean: `customers!private_label_job_orders_customer_id_fkey` or `customers!private_label_job_orders_billing_customer_id_fkey`.

## Floor sequence

The floor display lists issued orders in an explicit **floor sequence** (1 = next), not by the priority label. Private label and company product orders share **one queue**: it is one floor and one "what next" question. (`supabase/migrations/20261114120000_private_label_floor_sequence.sql`)

- **Where it is set.** Planning → Private Label Job Orders (or Company Product Job Orders) → **Floor sequence**. The dialog lists every Issued order in its current order; move rows with the top / up / down / bottom buttons and **Save sequence**. The whole list is saved in one go, so there are never two orders with the same number and never a gap.
- **Who can set it.** The same people who can issue these orders: the `planning` module (`super_admin`, `admin`, `manager`, `production_operator`, `closing_data_poster`). The database checks the role again in `pljo_can_sequence`, so no other screen can change the queue. The production operator's 48-hour edit window does not apply: sequencing is floor scheduling, not an edit of the order.
- **Automatic.** Issuing an order adds it at the **end** of the queue; it never jumps ahead unless someone moves it. Close or Cancel removes it and closes the gap. "Production done" on the floor keeps the number; Reopen keeps it too.
- **If the queue changed meanwhile.** If someone issued or closed an order while the dialog was open, Save is refused with "The issued orders changed since the list was loaded" and the dialog reloads. Reorder again and save.
- **On the floor.** Every tile shows its number in a large badge; the first live tile is marked **NEXT**. Tiles stay in sequence: an overdue 2-hour update colours the tile red and sounds the alarm, but no longer moves the tile to the front. Done tiles (when shown) list after the live ones. The page polls every 15 seconds, so a reorder shows within that time.
- **Lists and the order dialog.** The job order lists have a **Seq** column for Issued rows, and the order dialog shows "Floor #n" next to the status. Each change is in the **Log** as "Floor sequence set".
- **Priority stays.** The low / medium / high / critical field is still on the form and the print, and it is the fallback order for an order with no number (only possible before the migration's backfill ran). It no longer decides tile order on its own.
- **Storage.** The number lives in `private_label_floor_sequence` (one row per Issued order), not on the order itself, so a reorder never touches the order's `updated_at` (which drives the floor's 2-hour update clock) and never writes an "Edited" log entry.

## Dispatch

When a private label or company product job order is completed, or goes out, the people who can issue orders take it off the floor with one click. (`supabase/migrations/20261115120000_private_label_dispatch.sql`)

- **Where.** A truck button on every Issued row of the job order lists (green when the floor has marked production done), a **Dispatch** button beside Close in the order dialog, and a truck button on every row of the **Floor sequence** dialog (save or reset any pending moves first).
- **Who.** The same roles as Floor sequence: `super_admin`, `admin`, `manager`, `production_operator`, `closing_data_poster`. The database checks the role in `pljo_dispatch`.
- **What happens.** The status becomes **Dispatched** (final, like Closed): the order leaves the floor display on its next refresh and leaves the floor queue, and the numbers below it shift up. `dispatched_at` / `dispatched_by` are stamped; the Log shows "Dispatched" with the note; the print shows the dispatched date.
- **Below 100 % produced.** The confirmation shows produced vs ordered. If the order is not fully produced a note is required (e.g. partial dispatch, balance cancelled); at 100 % the note is optional.
- **Close stays.** Close is still there for an order that ends without a dispatch. Cancel still needs a reason.
