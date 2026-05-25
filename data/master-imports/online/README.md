# Online Module v1 Data Import

Migrated v1's online sales module data into v2.

| Table | Rows | Status |
|---|---|---|
| `online_platforms` | 2 | ✅ Loaded earlier (Shopify, Website) |
| `online_items` | 7 | ✅ Loaded earlier |
| `online_orders` | 240 | ✅ Loaded |
| `online_order_items` | 239 | ✅ Loaded |
| `online_load_sheets` | 1 | ✅ Loaded |
| `online_dispatches` | 0 | (none in v1) |
| `online_returns` | 0 | (none in v1) |

## Notes

- `confirmed_by` / `prepared_by` columns were NULL'd (v1 user UUIDs absent in v2).
- `item_id` references resolve to v1's `online_items` UUIDs already imported.
