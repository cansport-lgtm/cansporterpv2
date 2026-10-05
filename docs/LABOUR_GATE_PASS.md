# Labour Gate Pass (workers leaving during the day)

Part of the Labour Productivity module. Worker passes get their own number
series `LGP-000001`, `LGP-000002`, … (the material passes stay `GP-…`).

Database: `supabase/migrations/20261002120000_labour_gate_pass_roles.sql` (role)
and `20261002120100_labour_gate_pass.sql` (tables, functions, cron). Rollback in
`supabase/rollbacks/20261002120100_labour_gate_pass_down.sql`.

The screens (register, form, pass page, approvals, the Gate Check panel and the
dashboard cards) are shared with the staff gate pass (`docs/STAFF_GATE_PASS.md`):
they live in `src/components/person-gate-pass/` and are driven by the
`WORKER_PASS` variant in `src/lib/personGatePass.ts`.

## Pass kinds

| Kind | Meaning | What happens |
|---|---|---|
| **Half day** | The worker leaves and does not come back today | When the guard scans the worker out, the date is marked **Half day** (see below) |
| **Short leave** | Personal errand: goes out and comes back, expected within N minutes (default 30) | Guard scans **Out**, later **In**. Out time, in time and minutes outside are recorded. Late return notifies the supervisor and the approvers. **Over 3 hours outside → Half day; over 6 hours → Absent** (see below). Still out at day end → **Not returned**, with whatever effect the time outside earned |
| **Official duty** | Company work: purchases, bank, site visit, delivery. Expected within N minutes (default 180) | Guard scans **Out**, later **In**. A **destination** is recorded with the purpose. **Attendance is never touched.** Late return is information for the labour approvers, not a warning. Still out at day end → **Not scanned in**, no half day, labour approvers informed |

Official duty was added in `20261005120000_labour_gate_pass_official_duty.sql`
(rollback `supabase/rollbacks/20261005120000_labour_gate_pass_official_duty_down.sql`),
the same as the staff version.

### Official duty: approval

- Supervisors raise it like any other kind (workers have no login, so there is
  no self-service).
- **Field duty allowed** (switch on the Employee Center form) → the pass is
  **approved the moment it is raised** and logged as auto-approved; the worker
  goes straight to the gate. Otherwise `labour_gate_pass_approver` approves as usual.
- The supervisor who raised a pass can cancel it before it is scanned Out.
- Several trips a day are fine: once a trip is scanned In the day is free for
  the next pass.
- The register shows a **Company work** summary (trips, time outside, not
  scanned in, destinations) per worker for the selected dates, with Excel export.

## Flow

```
supervisor applies → pending approval → approver approves → approved → gate scan OUT → out
                                       ↘ rejected                                    ↘ (short leave) gate scan IN → returned
cancel: the supervisor who applied, or the approver, while pending / approved
expired:      approved (or still pending) but never scanned by day end
not returned: short leave still out at day end
```

- One live pass (pending / approved / out) per worker per day, enforced by the
  database. A short leave that is back (`returned`) frees the day again.
- A pass can be applied for today or up to 7 days ahead. It is valid at the gate
  only on its date.

## Roles (no HR role is used)

| Role | Can |
|---|---|
| `labour_productivity_poster`, `floor_incharge`, `labour_productivity_approver` | Apply (the supervisors who post daily entries); cancel their own pass before it is out |
| `labour_gate_pass_approver` (new) | Approve / reject, cancel any pass before it is out, convert an overdue short leave to a half day. Lands on **Gate Pass Approvals** and sees only the worker gate pass pages |
| `gate_security`, `gate_pass_manager` | Scan Out / In on the Gate Check page |
| `labour_productivity_viewer` | Register read-only |
| `super_admin` | Everything, plus the settings |

Every write goes through the `labour_gate_pass_*` database functions, which
check these roles; the tables are read-only to the app.

## Pages (Labour Productivity group)

| Page | Route | What it shows |
|---|---|---|
| Worker Gate Passes | `/labour/gate-pass` | Register (today by default), the four cards, **Outside now** (overdue in red), red **Old worker passes scanned again** card |
| New Worker Gate Pass | `/labour/gate-pass/new` | Worker picker with photo, kind, date, leaving time, expected minutes, reason |
| Pass page | `/labour/gate-pass/:id` | QR, printable slip, worker photo, timeline, approve / reject / cancel / convert |
| Gate Pass Approvals | `/labour/gate-pass/approvals` | Queue for the approver, plus short leaves overdue at the gate |
| Gate Check | `/gate-pass/check` | **Goods / vehicle** and **Worker** modes on the guard's existing page |
| Labour Dashboard | `/labour/dashboard` | The four cards at the top |

## At the gate

The guard's Gate Check page has two modes, **Goods / vehicle** (`GP-…`) and
**Worker** (`LGP-…`). A scanned QR picks the mode by its prefix; in Worker mode
the guard can also type the worker's code to open today's approved pass.

The screen shows the worker's **photo**, code, name, department, pass kind,
date and who approved it. The guard compares the worker with the photo and
taps **Worker matches · Mark OUT** (or **Worker is back · Mark IN**).

- Only an `approved` pass for **today** can go out; only an `out` short leave
  for today can come in.
- The same guard tapping twice within 10 seconds gets the same answer, not a
  second exit.
- The guard never sees salary or any money.

### Old pass scanned again

If the guard opens a pass that was already used (half day already out, short
leave already returned, not returned, expired, cancelled, rejected) or a pass
for another date, Gate Check turns red, sounds the siren for 20 seconds (the
guard can silence it) and vibrates the phone: **do not let the worker
through**. Every attempt is logged in the pass history (`rescan_attempt`: who,
when, status). The approvers, the supervisor who applied and the gate pass
managers get a notification, at most once per pass every 10 minutes. The
register and the Labour Dashboard show a red **Old passes scanned again** card
for the last 7 days, and the pass page shows a red banner.

## Time-outside thresholds (short leave)

Added in `20261006120000_labour_gate_pass_outside_thresholds.sql` (rollback in
`supabase/rollbacks/`). Official timing is **08:30 to 19:30**
(`day_start_time` / `day_end_time` in the settings).

| Time outside, inside official hours | Effect on that date |
|---|---|
| up to 3 hours (`half_day_after_minutes`, 180) | nothing |
| over 3 hours | **Half day** — the same marking as a half-day pass |
| over 6 hours (`absent_after_minutes`, 360) | **Absent** — the worker's productivity entries for that date are deleted (a snapshot is kept in the pass history, event `absent_marked`) and the trigger refuses any new entry for that worker and date |

- Time counts from the gate-out scan to the gate-in scan or to day end, clipped
  to 08:30–19:30. A scan-out before 08:30 counts from 08:30.
- The effect is applied **live** by the five-minute tick the moment the
  threshold is crossed (while the worker is still outside), or at the gate-in
  scan, whichever comes first. Scanning in afterwards never undoes it.
- Still out at day end: the time outside up to 19:30 decides. Under 3 hours
  means **no effect** (the old automatic half day on "not returned" is gone);
  the pass still closes as Not returned and the supervisor and approver are told.
- The effect is stored in `labour_gate_passes.attendance_effect` and shown on
  the pass page, the register ("½ day" / "ABSENT" in the Gate column, filters
  "Marked half day" / "Marked absent"), the Gate Check result after scan-in,
  and the dashboard card "Half days / absents by gate pass".
- Notifications: crossing 3 hours → supervisor and approver (warning);
  crossing 6 hours → supervisor and approver (error); approved entries deleted
  → labour productivity approvers.
- Half-day passes and official duty are not affected by the thresholds.
- Salary: an absent date pays zero days and counts as a full-day absence for the
  attendance allowance. Attendance Sheet and Time Sheet show **A** with the pass
  in the tooltip. Daily Entry shows the reason and blocks saving.

## Half day marking

Labour attendance is the `work_type` of the worker's rows in
`labour_productivity_targets` (full_day = 12 MPH, half_day = 6 MPH), which the
Attendance Sheet, Time Sheet and Labour Salary read. So:

- When a half-day pass goes **Out** (or a short leave becomes **Not
  returned**), `labour_gate_pass_mark_half_day` sets every productivity row of
  that worker for that date to `half_day`, fills `check_out` with the gate-out
  time where blank, and adds the remark "Left on gate pass LGP-…". **Approved
  rows are changed too** (the gate is the fact on the ground); the labour
  productivity approvers are notified when that happens.
- A trigger on `labour_productivity_targets` keeps any row added or edited
  later for that worker and date at `half_day` — the entry form, the Excel
  import and edit requests alike. The Daily Entry form shows this and locks
  Work type to Half Day.
- Labour Salary caps such a date at **0.5 day** whatever the rows say (without
  this, two half-day rows on one date would count as a full day).
- Attendance Sheet and Time Sheet show the date as a half day, with the pass
  number and gate-out time in the cell tooltip, even when no productivity row
  was posted.
- The view `v_labour_gate_pass_half_days` lists these dates.

There is no override: once the worker is out on a half-day pass, that date is
a half day.

## Notifications (module `labour`, link to the pass page)

| Event | To |
|---|---|
| Applied | Approvers (and super admins) |
| Approved / rejected | The supervisor who applied |
| Cancelled | Supervisor and approvers (never the person who cancelled) |
| Out / In | Supervisor (approvers too when the worker is late) |
| Late back (expected + grace, default 15 min) | Supervisor and approvers |
| Not returned at day end / expired | Supervisor and approvers |
| Short leave over 3 h outside (half day) / over 6 h (absent) | Supervisor and approvers (warning / error) |
| Official duty: still out past expected, back late, not scanned in at day end | Supervisor and labour productivity approvers, as **info** (never a warning, never the approver) |
| Approved productivity entry changed to half day | Labour productivity approvers |
| Old pass scanned again | Approvers, supervisor, gate pass managers |

## Scheduled job

`labour_gate_pass_tick()` runs every 5 minutes on pg_cron
(`labour-gate-pass-tick`): it sends the late-back notices and, after the
day-end time, closes the day (unused passes → `expired`, short leaves still
out → `not_returned` + half day). Passes for past dates are closed on the next
run whatever the time.

## Settings (`labour_gate_pass_settings`, super admin via `labour_gate_pass_settings_update(jsonb)`)

| Setting | Default |
|---|---|
| Official start (`day_start_time`) | 08:30 |
| Half day after minutes outside (short leave) | 180 |
| Absent after minutes outside (short leave) | 360 |
| Default expected minutes for a short leave | 30 |
| Grace minutes before "late back" | 15 |
| Day-end time (`day_end_time`, Asia/Karachi) | 19:30 |
| Mark half day when not returned at day end | no longer used: the thresholds decide |
| Default expected minutes for official duty | 180 |
