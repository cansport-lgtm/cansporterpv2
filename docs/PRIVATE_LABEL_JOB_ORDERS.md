# Private Label Job Orders

Production Planning → **Private Label Job Orders** (`/planning/private-label-job-orders`).

A separate job order form for private-label work. Each order covers **one customer and one grade (ball)**. Each line is a **size** with its quantity, packing and master packing. Every change is kept in a **log**.

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
| Customer | Customers master | yes |
| Grade (ball) | Grades master, one per order | yes |
| Brand name, customer PO / ref, required-by, priority, remarks | typed | no |
| **Logo** | uploaded file (PNG, JPG, SVG, WEBP or PDF, up to 10 MB), or one of the customer's logos from Customer Logos | to issue |
| Artwork / other files | uploaded | no |
| Lines: **Size** | Size list (**Sizes** button on the page) | yes |
| Lines: Qty (dozens) | typed | yes |
| Lines: **Packing** | Packing Master (`packing_types`, e.g. "12 Dz CTN") | yes |
| Lines: **Master packing** | items of the **Cartons** and **Master Packing 2** columns. Their categories are set on Products / SKUs → Column setup | yes |
| Lines: Packs per master | typed | yes |

- **Packs** = qty ÷ the packing's dozens, rounded up.
- **Master packs** = packs ÷ packs per master, rounded up.
- Both are calculated on the form and the print, not stored.

### Logo handling
- **Copied when picked.** A logo picked from Customer Logos is copied into the order. Changing or deleting the customer's logo later doesn't change an order that has already been issued.
- **Storage.** Files live in the public storage bucket `private-label-logos`, under `pljo/<order id>/`.

### Size list
- Sizes are switched off, never deleted, so old orders still show their size.
- A switched-off size stays on the orders that use it, but can't be picked for new lines.

## Status

```
Draft ──Save & Issue──▶ Issued ──Close──▶ Closed
  │                       │
  └──────Cancel (reason)──┴──────────────▶ Cancelled
```

The database enforces these rules, so no screen can get around them:

- **Draft:** everything can be edited. A Draft can be deleted; its number is not reused.
- **Issue:** needs at least one line and a logo.
- **Issued:** only remarks can change. It can be closed or cancelled.
- **Closed and Cancelled:** final, nothing can change.
- **Who can act:** the same people as Job Orders (the `planning` module). A production operator who is not a super admin can edit only within 48 hours of creating the order.

## Log

Each order has a **Log** tab with the time, the user and what changed. Every entry is written automatically by the database:

| Entry | Written when |
|---|---|
| Created | The order is first saved (records the full header) |
| Edited | Header fields change (old → new) |
| Issued, Closed, Cancelled | The status changes |
| Line added / changed / removed | A line changes (with size, qty, packing and master packing) |
| Logo uploaded / removed, Artwork uploaded / removed | A file is added or removed |
| Printed | The form is printed (via `pljo_log_printed`) |

- **Can't be edited.** The log can't be changed or deleted from the app.
- **Audit Log too.** All changes also appear in the central Audit Log under module `planning`.
- **Deleting a Draft deletes its log.** The central Audit Log still records the deletion.

## Printed form

One A4 page per order, printed with the iframe `printDocument()` helper. It shows:
- the company header, the **PLJO number**, dates, priority and status,
- the customer, brand and PO, the **grade**,
- the **logo**,
- the sizes table with packing, master packing and calculated packs, plus totals,
- remarks and signature boxes.

Printing is available once an order is issued.
