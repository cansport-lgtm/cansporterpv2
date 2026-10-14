# Private Label Job Orders — Plan

Status: **plan only, nothing built yet.** Open questions are at the end.

## Goal

Production Planning gets a separate **Private Label Job Order** form. For each order the team:

- generates its own job order number and form (printable / PDF),
- picks a **grade**, uploads the customer's **logo**, and enters the **size**, **packing** and **master packing**,
- can see a full **log** of everything that happened to the order (who created, changed, issued, printed, closed or cancelled it, and what changed).

## Rule: it must not interfere with existing job orders

Normal job orders (`job_orders`, `job_order_items`, `JO-YY-NNNN`, `/planning/job-orders`) stay exactly as they are:

- **New tables only.** No columns are added to, and no triggers or functions are changed on, `job_orders` or `job_order_items`.
- **Its own number series**, `PLJO-YY-NNNN`, with its own counter, so it never takes or skips a `JO-` number.
- **Its own page and route.** The existing Job Orders page, Production Coordinator, Store Management, material issuance and the dispatch planner don't read the new tables. Linking them can come later if you want it.
- **Shared masters are read-only.** `grades`, `packing_types` and `customer_logos` are only read, never written.

## Database (one migration: `supabase/migrations/2026XXXXXXXXXX_private_label_job_orders.sql`)

### `private_label_job_orders` (header)

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `pl_job_order_number` text UNIQUE | `PLJO-YY-NNNN`, set by trigger |
| `order_date`, `required_by_date` | |
| `customer_id` | FK `customers` (the private-label brand owner) |
| `brand_name` text | Brand printed on the product |
| `customer_po_ref` text | Customer PO / reference |
| `status` | `Draft → Issued → Closed`, or `Cancelled` (CHECK) |
| `priority` | low / medium / high / critical, same as job orders |
| `remarks` | |
| `issued_at/by`, `closed_at/by`, `cancelled_at/by`, `cancel_reason` | |
| `created_by`, `created_at`, `updated_at` | |

### `private_label_job_order_items` (one row per grade / size line)

| Column | Notes |
|---|---|
| `job_order_id` | FK, ON DELETE CASCADE |
| `grade_id` | FK `grades`, **required** |
| `product_id` | FK `products`, optional (customer SKU if one exists) |
| `size` text | **Required.** There is no size master today, so it's free text with suggestions from past entries. |
| `quantity` numeric, `unit` | Default unit is dozens |
| `packing_type_id` | FK `packing_types` (inner packing, e.g. "12 Dz CTN"), **required** |
| `packing_detail` text | Free text, e.g. "polybag per piece, sleeve" |
| `master_packing_type` text | Outer carton or bag |
| `master_packing_qty` numeric | Inner packs per master pack |
| `master_packing_detail` text | Carton marks, labelling, dimensions |
| `logo_attachment_id` | FK to the attachments table below; falls back to the header logo |
| `remarks`, `sort_order` | |

Totals (number of inner packs and master packs) are calculated in the UI and on the print. They aren't stored.

### `private_label_job_order_attachments` (logos / artwork)

The pattern copies `grn_attachments`: `job_order_id`, `kind` ('logo' | 'artwork' | 'other'), `file_path`, `file_name`, `file_size`, `mime_type`, `is_primary`, `uploaded_by`, `uploaded_at`.

- **New storage bucket:** `private-label-logos`, with storage policies scoped by `bucket_id`, same as GRN.
- **Upload path:** `pljo/<job_order_id>/<timestamp>-<name>`.
- **Allowed files:** PNG, JPG, SVG and PDF, up to 10 MB.
- The UI can also **pick an existing logo from `customer_logos`** for the chosen customer. The logo is copied into the job order's attachments, so later changes to the customer master don't alter a job order that's already been issued.

### `private_label_job_order_log` (the tracking log)

| Column | Notes |
|---|---|
| `job_order_id` | |
| `action` | created, updated, item_added, item_changed, item_removed, logo_uploaded, logo_removed, issued, printed, closed, cancelled, reopened |
| `field_changes` jsonb | `{field: {old, new}}`, changed fields only |
| `changed_by` | `app_user_id()` |
| `changed_at` | |

How it gets written:
- **Database triggers** on the header, items and attachments tables write the log, so every change is captured whichever screen made it.
- **Printing** is logged through a small RPC, `pljo_log_event(id, 'printed')`.
- **Append-only.** UPDATE and DELETE are revoked, the same way `audit_log` works.
- The three tables are also attached to the existing generic `audit_row_change('planning')` trigger, so super admins see them in the central Audit Log.

### Numbering

- A per-year counter table, `private_label_job_order_counters (yy, last_no)`, is incremented with `UPDATE … RETURNING` inside the BEFORE INSERT trigger.
- This avoids the MAX+1 race the existing `JO-` generator has, where two people saving at once could get the same number.
- The number is assigned only when the save succeeds.

RLS follows the existing planning tables, with policies dropped first (`DROP POLICY IF EXISTS`) so the migration can be re-run. A rollback script goes in `supabase/rollbacks/`.

## Frontend

| Piece | File |
|---|---|
| Domain logic (types, queries, upload, totals, status rules) | `src/lib/privateLabelJobOrder.ts` (uses `supabase as any`, as `productMaterials.ts` does, until types are regenerated) |
| List + form page | `src/pages/planning/PrivateLabelJobOrdersPage.tsx` |
| Form dialog | `src/components/planning/PrivateLabelJobOrderForm.tsx` |
| Logo uploader / picker | `src/components/planning/PrivateLabelLogoUpload.tsx` |
| Log timeline | `src/components/planning/PrivateLabelJobOrderLog.tsx` |
| Print / PDF | `src/lib/privateLabelJobOrderPrint.ts` via `printDocument()` (iframe print, not the blank-page-prone overlay) |
| Route | `/planning/private-label-job-orders` in `src/App.tsx`, wrapped in `ProtectedRoute` |
| Sidebar | "Private Label Job Orders" under Production Planning in `ERPSidebar.tsx` |

### List page
- Filters for status, customer, date range and search by number or brand.
- Columns: number, date, required-by, customer and brand, line count, total qty, status, and a logo thumbnail.

### Form
- **Header:** customer, brand, PO reference, dates, priority, remarks and the main logo, which you can upload or pick from the customer's logos.
- **Item lines:** grade (dropdown from `grades`), size, qty, packing (dropdown from `packing_types`) plus packing detail, master packing type, qty and detail, an optional per-line logo override, and remarks.
- **Validation:** every line needs a grade, size, qty > 0, packing and master packing. An order can't be issued without a logo.
- **Buttons:** Save Draft, Save & Issue, Close, Cancel (with a reason), Print.
- **Edit rules:** the same as job orders. A super admin can always edit; a `production_operator` can edit within 48 hours. Issued orders allow header remarks only. Closed and Cancelled orders are read-only.
- **"Log" tab** in the dialog: a timeline of who did what and when, with old → new values per field.

### Printed form (one A4 page per order)
- **Header:** company header, the large **PLJO number**, dates, customer, brand and PO.
- **Logo:** the logo image, plus per-line logos when they differ.
- **Item table:** grade, size, qty, packing, master packing, and calculated carton and bag counts.
- **Footer:** remarks and signature boxes (Prepared, Checked, Approved).

## Delivery phases

1. **Migration.** Tables, counter, triggers, log, bucket, policies and the rollback script. Test it on a Supabase branch first.
2. **Create and edit.** The `lib` module, list page, form (grade / size / packing / master packing), route and sidebar.
3. **Logos.** Upload, pick from the customer's logos, and show thumbnails.
4. **Log timeline and print** (print events get logged too).
5. **Docs and checks.** `docs/PRIVATE_LABEL_JOB_ORDERS.md`, plus `lint` and `build`. Smoke test:
   - create, issue, print and close an order,
   - check its log,
   - confirm the normal JO numbers and page are unchanged.

## Open questions (defaults in brackets)

1. **Level of grade / size / packing / logo.** Per line, so one order can hold several grades and sizes, or one set per order? [per line, with the logo on the header and an optional per-line override]
2. **Size.** Free text, or should we create a Size master list? [free text with suggestions]
3. **Master packing.** Pick from a list (e.g. Master Packing items from the material columns), or free text plus qty? [free text plus qty]
4. **Customer.** Must every private-label order be linked to a customer in the system? [yes]
5. **Number format.** Is `PLJO-YY-NNNN` OK? [yes]
6. **Who can create and issue?** The same as job orders (planning module), or restricted further? [same as job orders]
