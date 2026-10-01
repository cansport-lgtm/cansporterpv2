# WIP vs Finished Product in the Planning Item Master

**Production Planning → Planning Item Master** (`/planning/items`) lists the
department-wise items that planning, daily stock closing, job orders and the
monthly production report work from. Until now an item carried no indication
of *what* it is. Every item now has an **Item Type**, and finished products
carry the commercial details production works from.

## Item type

| `planning_items.item_type` | Meaning |
|---|---|
| `wip` | Work in process: the intermediate output of a department (cut panels, stitched covers, cores, …) |
| `finished` | A finished, sellable product |
| `NULL` | Not yet classified |

The master asks for the type on every save, so a new item is never
unclassified. Existing rows were backfilled by migration
`20261005120000_planning_item_types.sql`:

- items that a product in the Products master is dispatched from
  (`products.planning_item_id`) → `finished`
- items in a held-stock category (CPA / leak / rejection / lot) → `finished`
- everything else stays `NULL` and shows as **Unclassified** in the master.
  Use the *Item Type → Unclassified* filter to work through them.

The Products master's *Linked Planning Item* picker marks WIP items with
`[WIP]` so a sales product is not linked to an intermediate by mistake.

## Finished product details

When the Item Type is *Finished Product* the dialog shows a **Finished Product
Details** section. The columns live on `planning_items` and are cleared
automatically when an item is changed back to WIP.

| # | Field | Column | Notes |
|---|---|---|---|
| 1 | SKU Owner | `sku_owner_type` | `company` = our own product / SKU, `customer` = a customer's private-label SKU. Required for finished products. |
|   | Customer | `customer_id` | Required when SKU Owner = Customer. A check constraint keeps it NULL for company SKUs. |
|   | SKU Code | `sku_code` | The company SKU or the customer's own SKU / article code. |
| 2 | Felt | `felt` | Free text: felt type, supplier, colour. |
| 3 | Logo Picture | `logo_image_path` | Storage path in the public `planning-item-logos` bucket (PNG / JPG / SVG up to 5 MB). |
| 4 | Grade | `grade_id` | From the Grades master. |
| 5 | Packing | `packing` | Unit packing, e.g. *3 balls per can*. |
| 6 | Master Packing | `master_packing` | Master carton / bag packing, e.g. *6 Dz CTN*. The input suggests the labels from the sales Packing Types master but accepts any text. |

The list shows a **Type** column and a **Finished Product** column with the
logo thumbnail, SKU owner badge, SKU code and a one-line summary of the other
details.

## Logo pictures

Pictures upload to the `planning-item-logos` bucket as soon as a file is
chosen. The page cleans up after itself: a picture replaced or removed in the
dialog is deleted from storage when the item is saved, a picture uploaded in a
dialog that is then cancelled is deleted straight away, and deleting an item
deletes its picture. The bucket's policies are open like the other photo
buckets because the app signs in with its own `app_users` table rather than
Supabase Auth.

## Code

- `src/lib/planningItemTypes.ts` — type and SKU-owner metadata, filter helper,
  logo upload / URL / removal helpers.
- `src/pages/planning/PlanningItemMasterPage.tsx` — the master.
- Rollback: `supabase/rollbacks/20261005120000_planning_item_types_down.sql`
  (drops the columns; uploaded pictures are left in the bucket).

## Out of scope for now

- Other planning pages (daily stock closing, job orders, weekly planning) still
  list every planning item regardless of type. Filtering them by WIP / finished
  can follow once the existing items have been classified.
