# Rejections & Wastages – Daily Report (plan)

A one-day version of **Rejections & Wastages Analytics**. The rejections
manager adds remarks and submits it every day; a super admin approves it within
48 hours. Same pattern as the Key Raw Material daily remarks (#473), so the
table layout, SQL functions, hook and alert job can be copied and renamed.

Mockup: `docs/mockups/rejections-wastage-daily-report-mockup.html`

## Report content (one date, read-only figures)

- Tiles: rejected qty, wastage qty, leakage qty, total loss (Rs.)
- Loss split bar (rejection / wastage / leakage) with % and change vs the
  previous day and vs the previous 6-day average
- 7-day trend, top 5 reasons, department table
- **Manager remarks** (editable): overall summary, remark on the biggest-loss
  department, optional corrective action and owner
- History of every save / submit / review

Figures come from `rw_rejections`, `rw_wastages`, `rw_leakages` for that
`entry_date`, using the same aggregation as `RejectionsAnalyticsPage.tsx`.

## Workflow

```
draft -> submitted -> approved
            \-> rejected -> (edit) -> submitted ...
approved -> (reopen, super admin) -> draft
```

| Step | Who | Deadline (Pakistan time) |
|---|---|---|
| Write remarks, submit | `rejections_manager` (super admin can too) | Next morning 10:00 (Pakistan time). Reminder at 08:00 |
| Approve or reject with reason | `super_admin` | 48 h after submission |
| Re-submit after rejection or reopen | `rejections_manager` | 48 h after |
| Reopen approved report | `super_admin` | any time, logged |

Overdue days alert at once, then once a day at 09:00 until the day is
submitted / approved. Days with no R&W entries are skipped. Deadlines, alert
time and start date are settings, as in the key raw material remarks.

## Frozen figures and edit lock

On submit, a JSON snapshot of the figures is stored, so the approver reviews
exactly what the manager saw. While a report is submitted or approved, a
database trigger blocks adding, changing or deleting rejection, wastage and
leakage entries for that date. Rework status updates stay allowed because they
do not change the loss. A super admin reopens the report to unlock the day.

## Decisions (confirmed)

1. One report per day for all departments.
2. Manager submits by the next morning; super admin approves within 48 h.
3. Entry edits on submitted days are blocked.
4. A4 print with signature lines.

## Built

- `supabase/migrations/20261201120000_rw_daily_report.sql` (+ rollback in `supabase/rollbacks/`)
- `src/hooks/useRwDailyReport.ts`, `src/pages/rejections/RwDailyReportPage.tsx` (`/rejections/daily-report?date=`)
- `src/components/rejections/RwReportAlerts.tsx` on the dashboard, sidebar entry "Daily Report"
