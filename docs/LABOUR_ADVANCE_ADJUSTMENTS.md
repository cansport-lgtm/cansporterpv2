# Labour Advance Adjustments (super admin edits and deletes advances)

Part of the Labour Productivity module. Covers both **advances**
(`labour_advances`) and **travel advances** (`labour_travel_advances`), which
the Labour Salary page deducts from a worker's earned salary.

Database: `supabase/migrations/20261012120000_labour_advance_adjustments.sql`.
Rollback in `supabase/rollbacks/20261012120000_labour_advance_adjustments_down.sql`.

Screens: the **Advance** and **Travel Adv.** dialogs on **Labour Salary**
(`src/pages/labour/LabourSalaryPage.tsx`, route `/labour/salary`). One shared
component, `src/components/labour/LabourAdvanceDialog.tsx` (`kind` =
`advance` | `travel`); `AdvancePaymentDialog.tsx` and `TravelAdvanceDialog.tsx`
are thin wrappers over it. Helpers in `src/lib/labourAdvances.ts`.

## The problem it solves

An advance recorded against the wrong worker, with the wrong amount or on the
wrong date reduces the wrong salary. Before this change only the UI hid the
edit and delete buttons from non-super-admins: the tables were open to every
operation through the API, a locked salary month gave no protection, deletes
happened on one click and no reason was ever recorded.

Now the **super admin** has the right to adjust an advance, with a reason, and
the database enforces who may do it and when.

## Rules

| Action | Who | Condition |
|---|---|---|
| Record an advance | anyone with a login (as before) | the labour salary for the advance's month is **not locked** |
| Edit (date, amount, remarks) | `super_admin` only | month not locked (old and new date); reason of at least 5 characters |
| Delete | `super_admin` only | month not locked; reason of at least 5 characters; only through `labour_advance_delete()` |
| View, see change history | super admin sees history; everyone sees the list | always, locked or not |

**Locked months are read-only.** When the labour salary for the month is
locked (Labour Salary → Lock Salary), nothing can be added, edited or deleted
for that month, by anyone. Unlock the month first, adjust, then lock again.
The dialog shows a lock banner and hides the Add button and the adjust icons.

## Flow

```
super admin: Labour Salary → row → Advance / Travel Adv. icon → dialog
      → pencil   → change date / amount / remarks → Reason for adjustment → Save Adjustment
      → trash    → confirm dialog → Reason for deletion → Delete
      → Change history → every create / adjust / delete for that worker and month,
                         with who, when, before → after and the reason
```

- The reason is written on the row (`adjustment_reason`, with `updated_at`,
  `updated_by`) and travels into the central audit trail (`audit_log`, via the
  existing `audit_row_change` trigger). A deletion keeps the reason because
  `labour_advance_delete()` writes it onto the row before removing it, so the
  audit `delete` entry carries it in `old_values`.
- `created_by` is now filled server-side from the signed-in user; the salary
  page and dialogs invalidate their queries so totals refresh at once.

## Database

### Columns added (both tables)

`updated_at timestamptz`, `updated_by uuid → app_users`, `adjustment_reason text`.

### Functions and trigger

| Object | Does |
|---|---|
| `labour_advance_month_locked(date)` → bool | true when `salary_locks` has a `module = 'labour'` row for that month |
| `labour_advance_guard()` (BEFORE INSERT / UPDATE / DELETE on both tables) | INSERT: refuses a locked month, fills `created_by`. UPDATE / DELETE: super admin only, refuses a locked month (old or new date), UPDATE requires `adjustment_reason` ≥ 5 chars and stamps `updated_at` / `updated_by`; `id`, `employee_id`, `created_*` cannot be changed. DELETE requires the transaction flag set by `labour_advance_delete()` |
| `labour_advance_delete(kind, id, reason)` | `kind` = `advance` or `travel`. Super admin only. Writes the reason onto the row, sets the flag, deletes |

The acting user comes from `app_user_id()` (the `x-app-user-id` header the
frontend attaches to every request) and roles are checked in `user_roles`
through `has_role()`. The RLS policies on the tables are unchanged (allow-all);
the trigger is the guard.

Error messages the UI surfaces as toasts:

- `Labour salary for August 2026 is locked. Unlock it before adjusting an advance.`
- `Only a super admin can adjust an advance.`
- `Give a reason for the adjustment (at least 5 characters).`
- `Delete an advance through the Adjust dialog and give a reason.`
