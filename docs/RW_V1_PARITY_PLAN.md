# Rejections & Wastage — restore the v1 way of working (plan)

Status: **Plan only. Nothing built.**
Module: `rejections_wastages` (`rw_*` tables, `/rejections/*` routes).
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
| `rw_rejections` | 602 | 773 | 55 of 57 | **162** (27 Aug – 14 Sep) | 2 days differ (31 Jul, 25 Aug): 9 rows edited/added in v1 after the copy |
| `rw_leakages` | 2,349 | 2,938 | 60 of 61 | **581** (27 Aug – 15 Sep) | 1 day differs (25 Aug): 8 rows |
| `rw_wastages` | 33 | 33 | 23 of 23 | 5 (25 Aug – 9 Sep) | Live also has 5 rows of its own (3 Sep) that v1 lacks |

Live masters match the backup by id, with v2-only extras: a `Test` reason, a
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

## 3. The gap to close

| # | Gap | Where |
|---|---|---|
| G1 | Rejection and Leakage tabs are hidden for current dates | `RejectionsWastageEntryPage.tsx` (`rw_ball_cutover` check) |
| G2 | 743 v1 rows (27 Aug – 15 Sep) plus 17 edited rows are not in live | `rw_rejections`, `rw_leakages`, `rw_wastages` |
| G3 | Everything keyed in v1 **after 15 Sep** is not in this file at all | needs a fresh v1 export at cutover |
| G4 | Sidebar leads with Daily Checker Entry and ball-inventory screens the plant does not use | `ERPSidebar.tsx` |
| G5 | Test master rows in live (`Test` reason, `TEST`/`UNIT` units) will show in dropdowns | masters |
| G6 | `rw_leakages` has rework columns but Rework Tracking only reads `rw_rejections` | minor; v1 never used rework either |
| G7 | Department dropdown in v2 is filtered to `job_order_eligible_departments`; v1 rows use Quality Department and Packing too | `RejectionsWastageEntryPage.tsx` |

Not a gap: the entry form itself. It was ported from v1 and already does what
the data shows v1 did (department, shift, material with auto cost, qty, unit,
reason by type, disposition, remarks; super-admin edit; period filters;
dashboard and analytics by material / reason / department / cost).

---

## 4. Proposed plan

### Phase 0 — decisions (need the plant / owner)

1. **Fate of the ball-inventory build.** Recommended: *park it, don't drop it*.
   Hide its menu items and routes behind a super-admin-only "Ball Inventory
   (legacy)" group, keep all tables and the one downgrade record. Dropping is
   a one-way door and `20260830_rw_ball_inventory_down.sql` exists if it is
   ever wanted. Alternative: remove outright.
2. **Cutover date.** The day the floor stops keying into v1 and starts in v2.
   Everything in v1 up to that day must be exported again (G3).
3. **Conflicting rows.** For the 17 rows that differ (31 Jul, 25 Aug), take the
   v1 version (it was edited later, by the people who own the data). For the
   5 wastage rows live has and v1 lacks (3 Sep), keep them. Confirm.
4. **Masters.** Delete the `Test` reason and `TEST`/`UNIT` units from live, or
   just deactivate them. Keep `Down grade conversion` and the renamed
   `Quarantine to store` (harmless, v2-only).

### Phase 1 — restore the v1 entry flow (frontend only, one PR)

- `RejectionsWastageEntryPage.tsx`: remove the `rw_ball_cutover` gate so all
  three tabs show for every date. Default tab back to Rejections.
- Department list: show all active `production_departments` (drop the
  job-order-eligible filter) so Quality Department and Packing can be chosen,
  matching v1 usage. Optional: order by `sequence_order`.
- `ERPSidebar.tsx`: reorder to Dashboard → New Entry → Rework Tracking →
  Analytics → Masters (Reasons, Units, Dispositions, Materials). Move
  checker/bin/ledger/downgrade/defect-grade/checkpoint/location items under a
  collapsed super-admin "Ball Inventory (legacy)" header, or remove per
  decision 1.
- `RejectionsWastagesDashboard.tsx` / `RejectionsAnalyticsPage.tsx`: no
  schema change needed; drop the downgrade KPIs if the legacy group is hidden.
- Leave the `/rejections/checker` etc. routes in `App.tsx` so bookmarks don't
  404; they simply stop being advertised.
- No migration in this phase.

### Phase 2 — data merge from the backup (SQL, idempotent, run once)

- Load the three CSVs into staging tables (`rw_import_rejections`, …) in a
  one-off migration or via `psql \copy` against the live project.
- `INSERT … ON CONFLICT (id) DO UPDATE` for `rw_rejections`, `rw_leakages`,
  `rw_wastages`, updating only when the backup `updated_at` is newer than
  live. Expected effect: +171 rejections, +589 leakages, +5 wastages, 17
  rows updated, 0 deleted.
- Pre-checks in the same script: every `department_id`, `material_id`,
  `reason_id`, `disposition_id`, `entered_by` in the import exists in live
  (verified today: they do). Abort if any is missing.
- Masters: upsert `rw_reasons` / `rw_materials` / `rw_units` /
  `rw_dispositions` by id so names and costs match v1; apply decision 4.
- Post-check: per-day counts and totals equal the backup for every day ≤ 15 Sep.
- Keep the staging tables for a week, then drop.
- Ship the rollback alongside (`supabase/rollbacks/`): delete the inserted ids,
  restore the 17 overwritten rows from a backup table taken by the script.

### Phase 3 — final sync at cutover (G3)

- On the agreed cutover day, take a fresh v1 export (same zip format is fine)
  and rerun the Phase 2 script. It is id-keyed and idempotent, so the first
  run does not have to be redone.
- Then retire v1 R&W entry (remove permissions there, or redirect).

### Phase 4 — small parity fixes (optional, after go-live)

- Rework Tracking: include `rw_leakages` rows with `disposition = Rework` (G6).
- Masters pages: hide inactive rows from entry dropdowns (already done for
  reasons/units/dispositions/materials; confirm).
- Regenerate `src/integrations/supabase/types.ts` if any master column is
  added; none planned.
- Update `docs/`: mark the ball-inventory docs as parked, add a short
  "R&W working flow" doc describing the v1 routine.

### Verification

- Phase 1: build + lint; open New Entry on today's date and see three tabs;
  add/edit/delete one row of each kind as a non-admin and as super admin;
  dashboard and analytics totals change accordingly.
- Phase 2: the per-day hash comparison used for this analysis
  (`md5(string_agg(id order by id))` per `entry_date`) must match the backup
  on every day ≤ 15 Sep for all three tables; row counts 773 / 2,938 / 38.

---

## 5. Risks and open points

- **Stale source.** The file is 8 weeks old. Without Phase 3 the module will
  be missing everything the floor keyed since 15 Sep.
- **Two systems live in parallel** until cutover. Any v2 R&W row keyed before
  the final sync is safe (the merge never deletes), but reporting across the
  two will not reconcile until Phase 3 is done.
- **Costs are snapshots.** `unit_cost` on each row is whatever `rw_materials`
  said that day; the merge preserves them as-is. Changing a material's cost
  later does not restate history, same as v1.
- **Ball-inventory data.** 48 checker entries and 47 ledger rows exist in live.
  Parking keeps them readable; removing loses them. Either way they do not
  affect the simple logs.
- **Module permissions.** v1's five `rejections_wastages` grants should be
  checked against live `module_permissions` so the same people can key
  entries on day one.
