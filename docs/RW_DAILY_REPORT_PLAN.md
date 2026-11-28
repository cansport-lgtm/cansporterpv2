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
| Write remarks, submit | `rejections_manager` (super admin can too) | Day end (midnight after the report date) + 48 h. Reminder at +24 h |
| Approve or reject with reason | `super_admin` | 48 h after submission |
| Re-submit after rejection | `rejections_manager` | 48 h after rejection |
| Reopen approved report | `super_admin` | any time, logged |

Overdue alerts go to super admins once a day at 09:00 until the day is
submitted / approved. Days with no R&W entries are skipped. Deadlines, alert
time and start date are settings, as in the key raw material remarks.

## Frozen figures

On submit, store a JSON snapshot of the figures. The approver reviews exactly
what the manager saw. Later edits to entries do not change an approved report.
If entries for a submitted day are edited afterwards, flag the report
"figures changed since submit" and let the manager re-submit.

## Build

1. **Migration** `rw_daily_report.sql` (+ rollback):
   - `rw_daily_report_settings` (enabled, start_date, reminder_hours 24,
     submit_hours 48, approve_hours 48, alert_time)
   - `rw_daily_reports` (report_date PK, status, remarks, dept_remark,
     action_plan, snapshot jsonb, submitted_by/at, reviewed_by/at, review_note)
   - `rw_daily_report_history`, `rw_daily_report_alerts`
   - Read-only RLS; writes only through SECURITY DEFINER functions
     `rw_report_save`, `rw_report_submit`, `rw_report_review`, `rw_report_reopen`
   - `rw_report_days(from, to)` for the status list and `pg_cron` alert job
     (every 15 min, notifications with reference type `rw_daily_report`)
2. **Hook** `useRwDailyReport.ts` (copy of `useKeyRmRemarks.ts`)
3. **Pages**
   - `/rejections/daily-report?date=YYYY-MM-DD`: the report, role-aware
   - Status list tab (last 30 days) and rules tab (settings, super admin)
4. **Alerts**: `RwReportAlerts` card on the dashboard for super admins and
   manager reminders, plus bell notifications
5. **Sidebar** entry under Rejections & Wastages, plus module permission wiring
6. Optional: A4 print view with signature lines, Excel export of the day

## Open questions

1. One report per day for all departments, or one per department?
2. Is the 48 h submit window counted from midnight after the report date, or
   should the manager submit by next morning?
3. Block entry edits on submitted days, or flag and re-submit?
4. Print / PDF with signature lines needed?
