# Production — Super Admin edit of posted entries (plan)

## Where things stand today

Daily Production Entry (`/production/daily-entry`, `src/pages/production/DailyEntryPage.tsx`):

| Entry state | Who can edit | How it is enforced |
|---|---|---|
| Draft, within window | anyone with production `edit` (48h for `production_operator`, 72h otherwise) | front-end only |
| Draft, window expired | **super_admin only** (already works) | front-end only |
| Posted | **nobody** — must Unpost → edit → Post again | DB trigger `enforce_production_entry_posting_lock` + sibling trigger on `production_rejections` |

Unpost is available to everyone with production `approve` (production_operator, production_manager, …),
so today a non-super-admin can still change a posted day by unposting it, while a super admin has
no shortcut at all. The Production Entry List (`/production/entry-list`) is read-only and has no
Actions column.

## Goal

Give **super_admin only** an "Edit" action on **posted** production entries that saves the
correction in place (entry stays Posted, original `approved_by` / `approved_at` kept), with a
mandatory reason and a full audit trail. Nobody else gains any new edit right, and the server-side
lock stays intact for every other write path.

## Design

### 1. Database (one migration, e.g. `2026xxxx_production_super_admin_posted_edit.sql`)

1. **RPC `production_super_admin_edit_posted_entry(p_entry_id uuid, p_entry jsonb, p_rejections jsonb, p_reason text)`**
   `SECURITY DEFINER`, `search_path = public`.
   - Resolve the acting user with `app_user_id()` (header `x-app-user-id`, already set by the client).
     Raise unless `has_role(app_user_id(), 'super_admin')`. Raise if `p_reason` is blank.
   - Raise unless the entry exists and `status = 'Posted'` (draft edits keep using the normal path).
   - Run the grade-ledger stock check (`grade_ledger_available(..., p_exclude_entry => p_entry_id)`)
     and raise when it reports `block`, exactly as the UI does for drafts.
   - `PERFORM set_config('app.production_lock_bypass', 'on', true)` (transaction-local), then
     `UPDATE production_entries` with the editable columns from `p_entry`
     (quantity_produced, quantity_ok, quantity_rejected, target_production, shift, remarks, …;
     never `status`, `approved_*`, `created_*`), delete + re-insert `production_rejections`.
   - Insert one explicit `audit_log` row (`action = 'super_admin_posted_edit'`, `module = 'production'`,
     `details` = reason + before/after). The generic `audit_row_change` trigger already records the
     column-level diff for both tables, so this row only adds the reason.
2. **Lock triggers**: `enforce_production_entry_posting_lock` and
   `enforce_production_rejection_posting_lock` get one extra early-return:
   `IF current_setting('app.production_lock_bypass', true) = 'on' AND has_role(app_user_id(), 'super_admin') THEN RETURN NEW/OLD`.
   The flag can only be set inside the RPC, so a plain `UPDATE` from the browser (or any other
   client) is still rejected even for a super admin. Re-checking the role inside the trigger means
   the flag alone is never enough.
3. **Downstream** needs no code: `trg_production_entry_sync_consumption` (AFTER UPDATE) re-syncs
   the consumption day for old and new (date, grade, department); the grade ledger is a view over
   posted entries so it recalculates on read; the R&W apportioning deliberately skips posted keys
   and is unaffected.

### 2. Daily Entry page

- Posted rows: show the Pencil for `hasRole('super_admin')` only, titled "Edit posted entry (Super Admin)".
  Draft behaviour and the Post / Unpost buttons stay as they are.
- Reuse the existing dialog. When `editingEntry.status === 'Posted'`:
  - amber banner: "This entry is Posted. Your changes are saved directly, stay Posted, and are re-synced
    to Material Consumption and the Grade Ledger."
  - required **Reason** textarea (disabled Save until filled).
  - `updateMutation` calls the RPC instead of the direct `update` + rejection rewrite.
- Replace the current hard error "This entry is posted and locked. Unpost it before editing." with
  the branch above for super admins only.
- Optional: read `?edit=<id>` from the URL and open the dialog on load (needed for step 3).

### 3. Production Entry List page

- Add an Actions column, rendered only for `super_admin`, with a Pencil that navigates to
  `/production/daily-entry?edit=<id>&date=<entry_date>`. The list stays read-only for everyone else.

### 4. Permissions / sidebar

- No new role, no change to `MODULE_ROLE_ACCESS` or `hasModulePermission`. Gating is `hasRole('super_admin')`
  in the UI and `has_role(app_user_id(), 'super_admin')` in the DB.

## Out of scope (call out if wanted)

- Letting super admin **delete** a posted entry (today impossible even for super admin; would need the
  same bypass on the DELETE branch).
- Restricting **Unpost** to super admin — a separate decision; today any `approve` holder can do it.
- Editing posted **hourly production** or **labour productivity** entries (different modules, different locks).

## Files to touch

- `supabase/migrations/2026xxxx_production_super_admin_posted_edit.sql` (new; append to `all_migrations.sql`)
- `src/pages/production/DailyEntryPage.tsx`
- `src/pages/production/ProductionEntryListPage.tsx`
- `src/integrations/supabase/types.ts` (RPC signature)
- `docs/PRODUCTION_SUPER_ADMIN_EDIT.md` (user-facing note, on delivery)

## Test checklist

1. Non-super-admin: posted row shows no Pencil; calling the RPC directly raises "super admin only".
2. Super admin, posted row: edit quantities + rejections with a reason → row stays Posted, `approved_by/at`
   unchanged, `audit_log` has the reason row plus the row-change rows.
3. Super admin, blank reason → Save disabled / RPC raises.
4. Direct `UPDATE production_entries SET quantity_ok = …` on a posted row (any user) still raises the lock error.
5. After an edit, `consumption_stock_closing` synced row for that day/product reflects the new quantity;
   grade-ledger balance for the grade/bucket changes accordingly; stock check blocks an edit that would
   drive the ledger negative past the warning period.
6. Entry List → Pencil (super admin only) opens the Daily Entry dialog pre-loaded with that entry.
