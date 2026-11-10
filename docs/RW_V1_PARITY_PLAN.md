# Rejections & Wastage — back to the v1 module (plan)

Status: **Complete as of 10 Nov 2026.** Phases 1 and 2 shipped in #442 and
`20261118120000_rw_back_to_v1.sql`. Phases 3 and 4 were done in one step from
a fresh v1 backup taken 10 Nov 2026: `supabase/scripts/rw_v1_merge.py` inserted
680 rejections, 1,920 leakages, 19 wastages and 1 reason, and live now matches
that backup row for row (plus 5 wastage rows keyed in v2 on 3 Sep). The
comparison also found that `rw_leakages` lacked v1's three rework columns;
`20261119120000_rw_leakages_rework_columns.sql` adds them. The sections below
are the plan as written and are kept for the record.
Mockup: `docs/mockups/rejections-wastage-v1-parity-mockup.html` (open in a
browser; one screen per sidebar entry, sample figures only).
Source analysed: `cansport_db_backup_2026-09-15_v2_1.zip` (the v1 ERP database,
taken 15 Sep 2026 13:45 UTC; 246 tables, full SQL dump plus one CSV per table).

---

## 1. What the backup says the module is

The v1 Rejections & Wastage module is **seven tables and nothing else**: no
views, no functions, no triggers beyond `updated_at`, open RLS. Three
transaction logs and four masters.

| Table | Rows (15 Sep) | Purpose |
|---|---|---|
| `rw_rejections` | 773 | Rejected balls, per department / material / reason, with cost |
| `rw_leakages` | 2,938 | Leaker balls, same shape |
| `rw_wastages` | 33 | Material wastage (solvent, compound, kapra) in kg / ltr |
| `rw_reasons` | 13 | Reason list, typed `rejection` / `wastage` / `leakage` |
| `rw_materials` | 29 | Costed material list: `hp_material_id` + unit + unit cost |
| `rw_dispositions` | 5 | Scrap, Rework, Use-as-is, Return to Supplier, Quarantine (with Urdu names) |
| `rw_units` | 5 | pcs, dozen, kg, gram, ltr |

### How the floor actually used it (from the data, 14 Jun – 15 Sep 2026)

- **One row per material per day per department.** Department is Fancy Final
  (most rows) or Jorr; Packing and Quality appear a handful of times. Shift is
  always `Day`.
- **Material is the ball identity.** `material_id` points at `hp_materials`
  (JORR VM72, FINAL T70 YELLOW, …), never at `products`. `product_id`,
  `process_id` and `sub_department_id` are **empty in every row**. The
  `rw_materials` master exists only to attach a unit cost to each
  `hp_materials` row, so the entry form can auto-fill cost.
- **Cost is captured on every row.** `unit_cost` comes from `rw_materials`,
  `total_cost = qty × unit_cost`. 99% of rows carry a non-zero cost.
- **Reasons are used heavily.** 96% of rejections and 98% of leakages carry a
  reason. Two reasons dominate: *Gas girnai ka dhabba* (rejection, 627 rows) and
  *coly masam* (leakage, 2,077 rows).
- **Disposition / rework is essentially unused.** 772 of 773 rejections are
  `scrap`; one is `rework`. `rework_qty` is zero everywhere; `disposition_id`
  is filled on 5 rows in total. The Rework Tracking screen has no real data
  behind it.
- **Entered by one person.** 95%+ of rows were keyed by the QA supervisor
  (QA04); a QA executive (QA03) keyed most of the rest.
- Module permissions in v1: five users hold `rejections_wastages` rights (four
  full, one view-only).

Nearby but separate: `production_rejections`, `defect_reasons` and
`scrap_reasons` are an older, empty prototype (Jan 2026) and are not part of
this module.

---

## 2. Where v2 stands today

### Schema: already identical

`20260615130000_rejections_wastage_module.sql` ported the same seven tables
column-for-column (same names, types, defaults, check constraints, FKs,
indexes). Nothing in the backup schema is missing from v2. Later v2 migrations
did **not** alter these seven tables; they added new ones beside them.

### Data: v2 live was seeded from v1 on ~26–29 Aug and then stopped

Comparison of the live v2 database against the backup, per day, by row id:

| Table | Live rows | Backup rows | Identical days | Backup-only rows | Notes |
|---|---|---|---|---|---|
| `rw_rejections` | 602 | 773 | 55 of 57 | **162** (27 Aug – 14 Sep) | plus 9 rows added in v1 after the copy on 31 Jul and 25 Aug (171 in all) |
| `rw_leakages` | 2,349 | 2,938 | 60 of 61 | **581** (27 Aug – 15 Sep) | plus 8 rows added on 25 Aug (589 in all) |
| `rw_wastages` | 33 | 33 | 23 of 23 | 5 (25 Aug – 9 Sep) | Live also has 5 rows of its own (3 Sep) that v1 lacks |

Live masters match the backup by id, except that live lacks the
`COLY CRACKNESS` leakage reason (added in v1 on 8 Sep) and has v2-only extras: a `Test` reason, a
`TEST` and a `UNIT` unit, a `Down grade conversion` disposition, and
`Quarantine` renamed to `Quarantine to store`. Live `hp_materials` has extra
rows the backup lacks (L01–L04 LEAK, R01–R03 REJECTION) and dropped the
"Bag" suffix from names; every `hp_material_id` referenced by the backup
exists in live.

### The part that diverged: the "ball inventory" build

From 30 Aug 2026 v2 layered a different design on top (see
`REJECTION_WASTAGE_INVENTORY_PLAN.md`, `RW_BALL_INVENTORY_WORKFLOW.md`,
`RW_BALL_INVENTORY_CHANGELOG.md`):

- New tables: `rw_checker_entries`, `rw_checker_entry_intervals`,
  `rw_ball_ledger`, `rw_ball_stock`, `rw_locations`, `rw_defect_grades`,
  `rw_department_defect_grades`, `rw_defect_rates`, `rw_downgrades`; plus
  ~10 functions and the `rw_ball_cutover()` date (1 Sep 2026).
- New screens: Daily Checker Entry (grade × defect grid), Floor Bin Stock,
  Ball Ledger, Downgrade Requests/Approvals, Cheap Ball Rates, Defect Grades,
  Department Checkpoints, R&W Locations.
- **The New Entry page hides the Rejections and Leakages tabs for any date on
  or after 1 Sep 2026** and forces the user onto the checker grid. Only the
  Wastages tab remains.

What happened in practice: live holds **48 checker entries, 31 Aug – 22 Sep,
and none since**. Meanwhile the floor kept keying rejections and leakages
into v1 until at least 15 Sep (the backup date). The ball-inventory flow did
not take; the simple per-material log is what the plant uses.

---

## 3. Target: exactly v1

**Tables kept (7), unchanged:** `rw_rejections`, `rw_leakages`, `rw_wastages`,
`rw_reasons`, `rw_materials`, `rw_units`, `rw_dispositions`.

**Screens kept (8):** Dashboard, New Entry, Rework Tracking, Analytics, and the
masters for Reasons, Units, Dispositions, Materials.

**Removed from v2:**

| Kind | Objects |
|---|---|
| Tables (9) | `rw_checker_entries`, `rw_checker_entry_intervals`, `rw_ball_ledger`, `rw_ball_stock`, `rw_locations`, `rw_defect_grades`, `rw_department_defect_grades`, `rw_defect_rates`, `rw_downgrades` |
| Functions / triggers | `rw_ball_cutover`, `rw_post_checker_entry`, `rw_check_interval_sum`, `rw_rebuild_ball_series`, `rw_ball_ledger_after_change`, `rw_defect_standard_cost`, `rw_is_defect_output_grade`, `rw_downgrade_*`, any remaining `v_rw_*` views, and the auto-code triggers attached to `rw_locations` / `rw_defect_grades` |
| Screens (9) | Daily Checker Entry, Floor Bin Stock, Ball Ledger, Downgrade Requests, Downgrade Approvals, Cheap Ball Rates, Defect Grades, Department Checkpoints, R&W Locations |
| Code | `DowngradeDetailDialog.tsx`, `src/lib/rwDowngrades.ts`, their routes and sidebar items, the cutover gate on New Entry, the downgrade KPIs in Analytics |

Checked: nothing outside this module reads the nine added tables. The only
outside touch is `20261021120000_auto_master_codes.sql`, which attaches code
generators to two of them.

### Decisions taken

1. **Archive, then drop.** The nine added tables are copied into a
   `rw_archive` schema before the drop, so the 48 checker entries, 47 ledger
   rows and 1 downgrade stay readable by SQL.
2. **Dispositions back to the v1 five.** `Quarantine to store` is renamed back
   to `Quarantine`. `Down grade conversion` is deleted if no row references
   it, otherwise deactivated.
3. **Keep the five wastage rows keyed in v2 on 3 Sep.** The merge never deletes.
4. **Test masters removed:** the `Test` reason and the `TEST` / `UNIT` units
   (deleted if unreferenced, otherwise deactivated).

Still open: **the cutover date** for the final v1 export (Phase 4).

---

## 4. Plan

### Phase 1 — frontend back to v1

- `RejectionsWastageEntryPage.tsx`: remove the `rw_ball_cutover` gate; all
  three tabs on every date; Rejections is the default tab.
- Department list: unchanged. It is filtered to
  `job_order_eligible_departments`, which v1 has too with the same six
  departments (Fancy Final, Jorr, Press, Packing, Quality, Store).
- Delete the nine added pages, `DowngradeDetailDialog.tsx`,
  `src/lib/rwDowngrades.ts`, and their imports and routes in `App.tsx`.
- `ERPSidebar.tsx`: Dashboard → New Entry → Rework Tracking → Analytics →
  Masters (Reasons, Units, Dispositions, Materials).
- `RejectionsAnalyticsPage.tsx`: remove the downgrade queries and tiles.
- Any role / redirect entries that point at removed routes are cleaned up.

### Phase 2 — database back to v1 (same PR as Phase 1)

One migration, in this order:

1. `CREATE SCHEMA rw_archive`; `CREATE TABLE rw_archive.<t> AS TABLE public.<t>`
   for each of the nine tables.
2. Drop triggers, views and functions listed above, then the nine tables.
3. Masters clean-up per decisions 2 and 4, each guarded by a reference check.
4. No change to the seven v1 tables.

Ships with `supabase/rollbacks/20261118120000_rw_back_to_v1_down.sql`: replay
the ball-inventory migrations, then reload from `rw_archive`. Both directions
were tested on a local restore of the v1 backup. Regenerate
`src/integrations/supabase/types.ts` afterwards.

### Phase 3 — data merge from the backup (one-off script)

- Load the three CSVs into staging tables.
- Pre-check: every `department_id`, `material_id`, `reason_id`,
  `disposition_id`, `entered_by` exists in live (verified today: they do).
- Copy any live row the merge would overwrite into `rw_archive.merge_backup`.
- `INSERT … ON CONFLICT (id) DO UPDATE`, updating only when the backup
  `updated_at` is newer. Expected: +171 rejections, +589 leakages,
  +5 wastages (765 rows), 0 deleted; existing rows change only where v1
  edited them later.
- Masters: upsert `rw_reasons`, `rw_materials`, `rw_units`, `rw_dispositions`
  by id so names and costs match v1.
- Post-check: per-day count and `md5(string_agg(id order by id))` equal the
  backup for every day ≤ 15 Sep. Totals 773 / 2,938 / 38.

### Phase 4 — cutover

- On the agreed day, take a fresh v1 export (same zip format) and rerun the
  Phase 3 script. It is id-keyed and idempotent.
- Retire R&W entry in v1.
- Docs: mark `REJECTION_WASTAGE_INVENTORY_PLAN.md`,
  `RW_BALL_INVENTORY_WORKFLOW.md` and `RW_BALL_INVENTORY_CHANGELOG.md` as
  retired; add a short R&W working-flow note.

### Verification

- Phases 1–2: build and lint pass; no import of a removed file remains; New
  Entry on today's date shows three tabs; add / edit / delete one row of each
  kind as the QA user and as super admin; dashboard and analytics totals
  follow; `select count(*)` on each `rw_archive` table equals the pre-drop count.
- Phase 3: the per-day hash check above.

---

## 5. Risks and open points

- **Stale source.** The file is 8 weeks old. Without Phase 4 the module lacks
  everything the floor keyed into v1 since 15 Sep.
- **Dropping is one-way in practice.** The archive schema and rollback file
  make it recoverable, but the screens would have to be restored from git.
- **Two systems in parallel** until cutover; reports will not reconcile across
  them until the final resync.
- **Costs are snapshots.** `unit_cost` on each row is preserved as keyed.
- **Rework Tracking reads rejections only**, exactly as v1. Leakages carry
  rework columns that no screen uses; left as is for parity.
- **Module permissions.** v1's five `rejections_wastages` grants should be
  checked against live `module_permissions` before day one.
