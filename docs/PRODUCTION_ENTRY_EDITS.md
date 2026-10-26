# Production Entry Edits (daily entry edit tracking)

Part of the Production module. Every change made to a daily production entry
after it was first saved is logged, flagged on the entry everywhere it is
shown, and notified to the department and to every super admin.

Database: `supabase/migrations/20261118120000_production_entry_edit_tracking.sql`.
Rollback: `supabase/rollbacks/20261118120000_production_entry_edit_tracking_down.sql`.

Screens: the edit dialog on **Daily Entry** (`src/pages/production/DailyEntryPage.tsx`),
the **Entry Edit Log** page (`src/pages/production/ProductionEntryEditsPage.tsx`,
route `/production/entry-edits`), the super admin alert bar
(`src/components/production/ProductionEditAlertBanner.tsx`, rendered by
`ERPLayout` on every page) and the shared badge / highlight components in
`src/components/production/`. Shared helpers in `src/lib/productionEntryEdits.ts`.

## Rules

| Rule | Detail |
|---|---|
| Edit window | Anyone who is not a super admin may edit an entry only within **60 minutes** of creating it. Super admins have no window. Enforced in the database (`production_entry_edit`) and mirrored in the page. |
| Reason | **Mandatory** on every edit, at least 5 characters. Enforced by the trigger, so even a direct SQL update of the figures needs `last_edit_reason`. |
| Posted entries | Still locked. Unpost first (unchanged). |
| What counts as an edit | A change to date, shift, department, sub-department, grade, target, produced, OK, rejected, remarks, machine, operator, supervisor, or to the rejection breakdown. Posting / unposting is **not** an edit. |

## What happens on an edit

```
Daily Entry → Edit → reason → Update Entry
   │  rpc production_entry_edit(entry, fields, rejections, reason)
   ▼
production_entries UPDATE  ──trigger trg_production_entry_track_edit──►
   ├─ production_entry_edits: one row (who, when, why, before/after, per-field old → new,
   │                          rejection lines before/after, human summary)
   ├─ entry flags: edit_count +1, last_edited_at/by/reason, edited_fields
   ├─ notify_user → every ACTIVE user whose department is the entry's department
   │                (old and new department if it moved) + the entry's creator   (warning)
   └─ notify_role('super_admin') → every super admin, including the editor        (error / red)
```

Notifications go through the normal system notification stack: bell, toast,
`/notifications` inbox, desktop notification, and Web Push to phones with the
app closed (see `SYSTEM_NOTIFICATIONS.md`). Each one links to the edit in the
log (`/production/entry-edits?edit=<id>`).

### Super admin extra alert

- **Red alert bar** at the top of every page (all platforms) listing edits no
  super admin has acknowledged yet, with Acknowledge / Acknowledge all. It stays
  until each edit is acknowledged (`production_entry_edits_acknowledge`,
  `…_acknowledge_all`).
- **Siren + vibration** when the alert arrives while the app is open (sound is
  unlocked by the first tap on the page, as browsers require).
- **Daily reminder** at a set Pakistan time (default 09:00) while any edit
  stays unacknowledged (`production_entry_edits_daily_summary`, pg_cron every
  15 min; settings in `production_entry_edit_settings`, editable from the log
  page's gear icon).

## Showing edits on every platform

`production_entries` now carries:

| Column | Meaning |
|---|---|
| `edit_count` | Number of edits since the first save (0 = never edited). |
| `last_edited_at` / `last_edited_by` / `last_edit_reason` | Latest edit. |
| `edited_fields` | `{ field: originalValue }` for every field that still differs from the first save (plus `"rejections": true` once the breakdown changed). A field edited back to its original value drops out. |

Shared components (read the flag columns, no extra queries):

- `EditedBadge` – orange **Edited ×N** chip; tap opens the full history sheet.
- `EditedValue` – wraps a figure; edited figures get an amber highlight and a
  "was X" tooltip.
- `EditedEntriesNote` – "Includes N edited entries" chip for totals, charts,
  reports and exports built from entries.
- `useProductionEntriesLive()` – realtime invalidation so open screens (desktop,
  phone, PWA) refresh the moment an entry is edited elsewhere.

Applied on: Daily Entry, Entry List (plus an **Edited only** filter and
Edited / Last Edit Reason columns in the Excel export), Production Dashboard,
Production Reports, Target Dashboard, WIP Tracking / Ledger / Reconciliation,
the main Dashboard, the Labour MPH / Today's Target / Deployment pages and the
deployment Excel export, and the MPH loss calculations.

The `production_entries` and `production_entry_edits` tables are in the
`supabase_realtime` publication.

## Edit Log page

`/production/entry-edits` – every edit with filters (date, department, editor,
acknowledgement, search), per-edit old → new, reason, acknowledgement state,
Excel export, and (super admins) Acknowledge / Acknowledge all and the daily
reminder settings. Deep links: `?edit=<id>` (from a notification) scrolls to
and highlights that edit regardless of the date filter; `?open=1` shows only
unacknowledged edits.

The log keeps a snapshot (date, shift, department, grade names) so it stays
readable after an entry is deleted (`entry_id` becomes NULL, shown as "Entry
since deleted"). Edits also still land in the central `audit_log`.

## Establishing the feature

1. Apply the migration (`supabase db push` or the SQL editor). It adds the
   columns, the log table, the settings row, the trigger, the RPCs, the pg_cron
   job (only when pg_cron is installed) and the realtime publication entries.
2. Deploy the frontend. The route, sidebar link ("Entry Edit Log" under
   Production), alert bar and components are wired.
3. Nothing to configure. Optional: change the daily reminder time from the log
   page gear icon (super admin).
