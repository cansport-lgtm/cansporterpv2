# Fixed Assets v1 Data Import

Migrated v1's fixed asset module data into v2 (project ojejlhnthhdvgbgpsgvi).

## What's loaded directly

| Table | Rows | Status |
|---|---|---|
| `fixed_asset_categories` | 7 | ✅ Loaded |
| `fixed_assets` | 262 | ✅ Loaded (3 parts) |
| `asset_valuations` | 72 | ✅ Loaded |
| `asset_reconciliations` | 11 | ✅ Loaded |
| `asset_reconciliation_items` | 104 / 1036 | ⏳ Partial — parts 2-10 pending |

## How to finish loading reconciliation_items

`asset_reconciliation_items` is a 1036-row audit log of every asset checked during
each reconciliation. Part 1 (104 rows) is already loaded directly. To load the rest,
paste parts 2-10 into the Supabase SQL Editor:

1. Open https://supabase.com/dashboard/project/ojejlhnthhdvgbgpsgvi/sql
2. Paste contents of `05-asset_reconciliation_items_part2.sql` and Run
3. Repeat for parts 3 through 10

The module is fully usable now — categories, assets, valuations and reconciliation
headers are all in place. The reconciliation items are historical audit data; missing
them only means earlier reconciliation reports show fewer line items.

## Notes

- v2 had 4 seed `fixed_asset_categories` with different UUIDs than v1. Those were
  deleted before re-loading v1's 7 categories with original UUIDs.
- `created_by`/`approved_by`/`conducted_by`/`valued_by` columns referencing
  `app_users` were NULL'd since v1's user UUIDs don't exist in v2.
- `fixed_assets.department_id` resolves correctly because v1's
  `production_departments` UUIDs were already loaded earlier in the master-imports
  process.
