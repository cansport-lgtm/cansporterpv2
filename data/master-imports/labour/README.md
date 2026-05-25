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

## How to apply remaining chunks

Open https://supabase.com/dashboard/project/ojejlhnthhdvgbgpsgvi/sql in your browser, then for each `.sql` file:

1. **Productivity targets** (must do before edit_requests):
   - Apply `productivity_targets_chunks/chunk_001.sql` through `chunk_085.sql` in numerical order (`chunk_000.sql` already loaded).
   - Open each file, copy contents, paste into SQL Editor, click **Run**.

2. **Salary snapshots**:
   - Apply `salary_snapshots_chunks/chunk_01.sql` through `chunk_04.sql` (`chunk_00.sql` already loaded).

3. **Edit requests** (last):
   - Apply `labour_productivity_edit_requests.sql` once all productivity_targets chunks are loaded.

All chunks use `ON CONFLICT DO NOTHING` so re-running a chunk is safe.

## Notes

- v1 user UUIDs (e.g. `created_by`, `approved_by`, `requested_by`, `reviewed_by`) were `NULL`'d because v2's `app_users` doesn't share v1's IDs.
- `salary_locks` lock_ids in `labour_salary_snapshots` were verified to exist in v2 before this import.
- `production_departments` were assumed pre-loaded in v2; only `production_sub_departments` are imported here.
