# Master Data: administrator role and change log

Two additions to the Master Data module (`/master/*`: Departments, Grades,
Products/SKUs, Items, Units, Reason Masters, Hourly Loss Reasons):

1. A **Master Data Administrator** role (`master_data_admin`) that can do
   everything in Master Data, delete included.
2. A **Change Log** page for super admin that shows who changed which master,
   when, and exactly what changed.

Database: `supabase/migrations/20261005120000_master_data_admin_role.sql` (role)
and `20261005120100_master_data_change_tracking.sql` (audit triggers, index).
Rollback in `supabase/rollbacks/20261005120100_master_data_change_tracking_down.sql`.

## The role

| Role | View | Create | Edit | Approve | Delete | Where |
|---|---|---|---|---|---|---|
| `master_data_admin` (new) | yes | yes | yes | yes | **yes** | Master Data pages only |
| `master_data_manager` | yes | yes | yes | yes | no | Master Data pages only |
| `master_data_officer` | yes | yes | yes | no | no | Master Data pages only |
| `master_data_viewer` | yes | no | no | no | no | Master Data pages only |

Until now only super admin could delete a master record. The administrator
role may, which is why every master table is now under the audit trail (below):
nothing it does goes unrecorded, and super admin reviews all of it.

Like the other module tiers the role is confined to `/master` plus the dashboard
shell, and its lockdown is enforced even when the same login also holds a
flexible role (`STRICT_LOCKED_ROLES` in `src/contexts/AuthContext.tsx`). Assign
it on **Settings → Users** ("Master Data — Administrator"). It is listed on
**Settings → Roles & Permissions**.

The Hourly Loss Reasons page used to show its Delete button to super admin only;
it now follows the module's delete permission, so the administrator sees it too.

## Change tracking

The generic `audit_row_change()` trigger from the super admin audit trail
(`20260901120000_super_admin_audit_trail.sql`) is attached to every Master Data
table with module `master_data`:

| Master | Tables |
|---|---|
| Departments | `production_departments`, `production_sub_departments` |
| Grades | `grades` |
| Products / SKUs (own and customer SKUs) | `products` |
| Items | `items` |
| Units | `units_of_measure` |
| Reason Masters | `defect_reasons`, `downtime_reasons` |
| Hourly Loss Reasons | `hourly_loss_reasons`, `hourly_loss_reason_processes` |

Each insert, update and delete writes one `audit_log` row holding the full
before and after snapshot. The acting user, IP and user agent are stamped
server-side from the `x-app-user-id` request header, so the attribution does
not depend on the page that made the change. Updates that only touched
`updated_at` are skipped. The log is append-only for clients.

## The Change Log page

**Master Data → Change Log** (`/master/change-log`), super admin only
(`src/pages/master/MasterDataChangeLogPage.tsx`). It reads `audit_log` where
`module = 'master_data'`:

- **Cards**: changes today, changes in the chosen range, how many people made
  them, how many deletes.
- **Changes by person**: created / edited / deleted counts per user for the
  range and which masters they touched. Click a row to filter the list to that
  person. **Changes by master** does the same per master.
- **Filters**: date range (default last 30 days), master, action, user, and a
  search on the record's code or name (before or after the change).
- **List**: when, who (name and login), master, record (`CODE – Name`), action,
  and for edits a summary of the fields that changed. The eye icon opens the
  detail: a field-by-field before/after table for edits, the whole record for
  creates and deletes.
- **Export CSV** of the filtered list (up to 5,000 rows).

The same entries also appear in **Settings → Audit Log** under the new
"Master Data" module filter.
