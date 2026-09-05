# R&W Ball Inventory — Change Log (Phase 1)

Everything delivered in the session that built and shipped Phase 1 of the
Rejections & Wastage ball inventory. Merged to `main` in
[PR #255](https://github.com/cansport-lgtm/cansporterpv2/pull/255) (squash
commit `fda492d`), with the database migrations applied to the live Supabase
project (`ojejlhnthhdvgbgpsgvi`) and the frontend deployed through Vercel on
30 Aug 2026.

**Cutover: 1 September 2026** (`rw_ball_cutover()`). Before that date the
module records history only; from it, counts post stock and drive the
production figures.

---

## Why any of this exists

The module logged a rejection/wastage quantity and stopped there. Nothing
downstream had to agree with the number a checker typed, so under- and
over-reporting were both invisible, and defective balls could leave the floor
with no book trail. Leaker and reject balls are not waste — they are countable
balls sold cheap — so the fix was to give the checker's count an inventory it
must reconcile with.

Full design rationale: `docs/REJECTION_WASTAGE_INVENTORY_PLAN.md`.

---

## Database changes (5 migrations, all applied to live)

### `20260830120000_rw_ball_inventory_phase1` — the foundation

**New masters**

| Table | Holds |
|---|---|
| `rw_defect_grades` | The classes of defective ball (`LEAK_CORE`, `LEAK_COVERED`, `REJ_SPOT`, `REJ_SEAM`), each carrying its onward route: straight to the cheap-ball bin, held as WIP until covered, or counted-only |
| `rw_locations` | The bins: `JORR-LEAK` (leaker WIP), `LF-CHEAP`, `FF-CHEAP`, `PACK-CHEAP` (floor bins), plus `TRANSIT` and `STORE-CHEAP` for Phase 2 |
| `rw_department_defect_grades` | Which department counts which grade into which bin — drives the checker grid's columns, resolves the destination bin, and scopes the coverage check |
| `rw_defect_rates` | Book value and sale rate per (model, defect grade), with a per-grade default row; exact model match wins |

**New transaction tables**

| Table | Holds |
|---|---|
| `rw_checker_entries` | The daily floor count — one row per date/shift/department/model/defect grade, with a unique index so a day cannot be posted twice |
| `rw_checker_entry_intervals` | The optional interval tally; a deferred constraint trigger refuses a breakdown that does not add up to the day total |
| `rw_ball_ledger` | Every stock movement, with a running balance per (bin, model, defect grade) rebuilt on any change so back-dated entries stay correct |
| `rw_ball_stock` | The on-hand cache, trigger-maintained from the ledger |

**Behaviour**

- A checker entry posts stock into the bin its department/grade checkpoint
  names. A Jorr leaker core lands in the leaker-WIP bin (it is covered before
  sale); covered leakers and rejects land in the department's cheap-ball bin.
- Unit cost resolves per model (falling back to the grade default) and is
  snapshotted onto the ledger row, so later rate changes never rewrite past
  value.
- `production_entries.quantity_rejected` is **derived from the checker's
  count** (and `quantity_ok` recomputed), summing every defect grade —
  leakers included, since a leaker is equally a ball that was not OK.
  Because `production_entries` has no unique key on its production key, the
  figure is apportioned pro-rata by `quantity_produced` across however many
  rows share one, with cumulative rounding so the parts add back exactly
  (100 over 5000/3000/2000 → 50/30/20; 7 → 4/2/1).
- Views: `v_rw_entry_coverage` (a department that produced but posted no
  count) and `v_rw_defect_vs_production` (live defect % per production key).

### `20260830130000_rw_defect_output_grades` — the cheap ball is production's

Discovered mid-build: the sellable cheap ball is an **existing production
grade** — leakers sell as grade *Leak ball*, rejects as *Rejection* — booked
by the production module. Phase 1 was rewriting `quantity_rejected` on those
rows from checker counts, which is wrong: a cheap-ball production row has no
rejections of its own.

- `rw_defect_grades.output_grade_id` records which grade each defect class is
  sold as (matched by name, so the trailing space in the real `Rejection `
  grade is handled).
- The apportionment returns early for any output grade — those rows keep
  exactly what production entered.
- `v_rw_unlinked_models` lists ball models counted by a checker but missing
  `products.grade_id` — the bridge the derivation needs. 47 of 53 active
  products were unlinked at ship time.

### `20260830140000_rw_output_reconciliation` — a check that needs no new document

Because the *finished* cheap balls are booked by the department that *found*
the defect, and only leaker cores need a covering run in between:

- `v_rw_output_reconciliation` — counted vs booked per department-day. Where
  no covering step separates them the two numbers describe the same balls and
  must match exactly; a mismatch is flagged.
- `v_rw_leaker_wip_reconciliation` — the Jorr bin against the ledger and the
  covering output, keeping three numbers apart (`cores_counted`,
  `cover_out_posted`, `cheap_balls_booked`) so `bin_check` is pure arithmetic
  (always 0) and `unreleased_qty` reads as work waiting for Phase 2, not a
  loss.
- Cheap-ball production rows are excluded from the defect-rate and coverage
  views — they are output, not primary production.

### `20260830150000_rw_respect_production_posting_lock` — bug fix

`production_entries` carries a posting lock: once `Posted`, its data cannot
change. The apportionment writes exactly the locked columns, so a checker
saving a count for an already-posted day **failed with the lock's exception**
— reproduced, then fixed. 295 live entries were Posted, so this was real.

- Posted keys are skipped entirely (never partially rewritten).
- `v_rw_posted_entry_conflicts` reports posted entries whose figure no longer
  matches the count; unposting lets it flow through on its own.

### `20260830160000_rw_quiet_until_booking_starts` — no crying wolf

The plant intends to book cheap-ball production but has not started (zero
*Leak ball*/*Rejection* entries across 1,936 rows). The counted-vs-booked
mismatch flag now also requires the department to have booked that grade at
least once — the comparison always shows, the flag lights up on its own the
first time somebody books one.

### Also: `20260125194022` (January) made replay-safe

Every Supabase preview branch since January died on this migration: its
data-fix inserts a stock row for a location id that only exists in
production. The sync function now returns early when there is nothing to
sync. Inert for production (already applied by version); proven by a full
fresh replay going from 275 → 282 of 287 files applying.

### Rollback

`supabase/rollbacks/20260830_rw_ball_inventory_down.sql` — a manual
down-migration (deliberately outside `supabase/migrations/`) that removes
everything Phase 1 added and restores `production_entries` behaviour. Proven
on the test database and idempotent.

---

## Frontend changes

**New pages** (routes under `/rejections`, wired into `App.tsx` and the
sidebar, which now groups the module into Entries / Ball Inventory / Masters):

| Page | Route | What it does |
|---|---|---|
| Daily Checker Entry | `/rejections/checker` | The primary screen. Columns come from the department's checkpoints (Jorr sees one leakage column, Packing two reject columns); the destination bin is resolved, never picked; rows default to the models actually in production; live defect % with an above-band flag; optional per-grade interval tally that must sum to the day total; warns when a model on the grid has no production grade |
| Floor Bin Stock | `/rejections/bin-stock` | On-hand per bin/model/grade with value and age, plus three reconciliation panels: counted-vs-booked mismatches, leaker-WIP vs covering output, and posted-entry conflicts |
| Ball Ledger | `/rejections/ledger` | Every movement with running balance, filters, source badges |
| Defect Grades / Cheap Ball Rates / R&W Locations / Department Checkpoints | `/rejections/defect-grades`, `defect-rates`, `locations`, `checkpoints` | Masters (super admin, rates also for the manager tier) |

**Changed pages**

- `DailyEntryPage` (production): from the cutover, *Qty OK* and *Qty
  Rejected* are read-only and derived, with a note linking to the checker
  screen; the per-reason rejection detail card is hidden and
  `production_rejections` is no longer written.
- `RejectionsWastageEntryPage` (old R&W entry): the Rejections and Leakages
  tabs disappear for dates on/after the cutover (the checker screen owns
  those now); they remain for earlier dates where the 602 rejection and
  2,349 leakage history rows live. Material wastage stays throughout.
- `ERPSidebar`: new entries, section headers, and a one-line type fix that
  cleared four pre-existing errors.

No existing role enum was touched — the `rejections_manager` / `officer` /
`viewer` tiers cover the module.

---

## Bugs found and fixed along the way

1. **NULL arithmetic swallowed the defect %** — `leak + reject` is NULL when
   either side is; 90 leakers on 12,400 produced read as 0.00%.
2. **The apportionment would have multiplied the plant's rejected total** —
   `production_entries` allows several rows per production key; writing the
   full figure to each would double or triple it. Fixed with pro-rata
   apportionment.
3. **The production posting lock broke the checker's save** — see migration
   `150000` above. Missed originally because every test row defaulted to
   `Draft`.
4. **The January floor-inventory migration killed every preview branch** —
   see above.
5. **A misleading reconciliation column** — the first leaker-WIP view showed a
   single `drift_qty` that read as a 600-ball loss when it only meant "Phase 2
   is not built yet"; split into `bin_check` and `unreleased_qty`.

---

## Verification

- Migrations exercised on a local PostgreSQL 16 built by replaying the whole
  repo migration history: posting, edit, delete, duplicate-day and
  interval-sum guards, routing, per-model valuation, cutover, apportionment
  across 3 and 4 rows, posting-lock regression (including a reproduction of
  the pre-fix failure), cheap-grade exclusion, and all reconciliation views.
- Live database verified after applying: seeds present, output grades
  matched, `total_rejected` across all 1,936 production entries unchanged
  at 0. Migration-history versions aligned to the repo filenames so
  `supabase db push` stays coherent.
- `npm run build` green; no new TypeScript errors.
- A design mockup of the six Phase 1 screens was reviewed and approved before
  any code was written.

---

## Open items

| Item | Status |
|---|---|
| Link `products.grade_id` on ~47 ball models | **Blocks the production sync** for those models; `v_rw_unlinked_models` lists them, the checker screen warns |
| Fill in Cheap Ball Rates | Counts post at zero value until set; quantities are unaffected |
| Start booking *Leak ball* / *Rejection* production | The counted-vs-booked check stays quiet until this begins |
| Repo missing `20260830141303_party_type_matches_control_account` | Applied remotely (another session), no file in the repo |
| Maintenance data imports (`20260828*`, from #250) fail fresh replays | Pre-existing; only affects Supabase preview branches, never production |
| Phase 2 — cover transfer (a consumption document releasing cores from the Jorr bin) and the daily blind handover to the store | Designed in the plan; unblocked |

---

## Post-release change: track by grade, not by product (5 Sep)

Migration `20260905130000_rw_track_by_grade`. The first week of live use
showed the product keying was wrong: 14 of 16 entries pointed at sales SKUs
with no grade link, so counts posted to the ledger but never reached the
production figures — and the floor's own history (2,349 leakage rows, 591
rejection rows) had always identified balls as stage + grade, never as a
product. The plant confirmed: use the production module's `grades` master and
track only grades.

- `rw_checker_entries`, `rw_ball_ledger`, `rw_ball_stock` and `rw_defect_rates`
  now carry `grade_id`; `product_id` is gone. Existing entries whose product
  had a grade were mapped across (colliding rows merged, tallies dropped); the
  unmappable ones were deleted, per the plant's instruction. Ledger and stock
  were wiped and reposted on the new key.
- The derivation lost its weakest link: a checker entry and a production entry
  now share `(date, shift, department, grade)` directly, so the
  `products.grade_id` bridge, `v_rw_unlinked_models` and the checker screen's
  unlinked warning are all gone — that failure mode can no longer exist.
- The checker grid's rows are now grades (defaulting to the grades in
  production that day, with the *Leak ball* / *Rejection* output grades
  excluded from the picker); rates are per grade × defect type.
- Material wastage is untouched: `rw_wastages` keeps `hp_materials`, because
  solvent, compound and kapra have no ball grade.
- Accepted trade-off, decided by the plant: size/colour detail (KB70 vs KB72,
  YELLOW vs GOLDEN) is not tracked — production books at grade level, so
  nothing could reconcile finer than that anyway.
