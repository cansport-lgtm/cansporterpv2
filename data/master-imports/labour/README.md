# Labour Productivity Module v1 → v2 Data Import

Migrated v1's labour productivity module data into v2.

## Load order & counts

Apply in the order listed. Tables with `Loaded` are already in v2; the rest need to be applied via Supabase SQL Editor (paste each file's contents and run).

| # | Table | Rows | Status | Notes |
|---|---|---|---|---|
| 1 | `production_sub_departments` | 13 | ✅ Loaded | |
| 2 | `labour_employees` | 198 | ✅ Loaded | |
| 3 | `labour_process_targets` | 56 | ✅ Loaded | |
| 4 | `labour_mph_authorized` | 31 | ✅ Loaded | |
| 5 | `mph_calculating_numbers` | 17 | ✅ Loaded | |
| 6 | `labour_travel_advances` | 44 | ✅ Loaded | |
| 7 | `labour_attendance_allowances` | 16 | ✅ Loaded | |
| 8 | `labour_advances` | 276 | ✅ Loaded | |
| 9 | `labour_productivity_targets` | 8 510 | ⚠️ Partial (100/8510) | Apply remaining 85 chunks from `productivity_targets_chunks/` |
| 10 | `labour_salary_snapshots` | 453 | ⚠️ Partial (100/453) | Apply remaining 4 chunks from `salary_snapshots_chunks/` |
| 11 | `labour_productivity_edit_requests` | 109 | ⏳ Pending | Apply AFTER step 9 (FK → productivity_targets) |

## How to apply remaining data — recommended path

Open https://supabase.com/dashboard/project/ojejlhnthhdvgbgpsgvi/sql, then paste each of these in order and click **Run**:

1. `productivity_targets_remaining.sql` — 8 410 rows (3 MB). **Required before step 3.**
2. `salary_snapshots_remaining.sql` — 353 rows (~100 KB).
3. `labour_productivity_edit_requests.sql` — 109 rows (FK → productivity_targets).

All statements use `ON CONFLICT DO NOTHING`, so re-running is safe if a paste partially completes.

### Fallback: smaller chunks

If the SQL Editor rejects the 3 MB paste, apply the chunks one-by-one instead:
- `productivity_targets_chunks/chunk_001.sql` → `chunk_085.sql` (~35 KB each)
- `salary_snapshots_chunks/chunk_01.sql` → `chunk_04.sql`

## Notes

- v1 user UUIDs (e.g. `created_by`, `approved_by`, `requested_by`, `reviewed_by`) were `NULL`'d because v2's `app_users` doesn't share v1's IDs.
- `salary_locks` lock_ids in `labour_salary_snapshots` were verified to exist in v2 before this import.
- `production_departments` were assumed pre-loaded in v2; only `production_sub_departments` are imported here.
