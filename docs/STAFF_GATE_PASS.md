# Staff Gate Pass (HR staff leaving during the day)

Part of the HR module: the staff equivalent of the worker gate pass
(`docs/LABOUR_GATE_PASS.md`). Staff passes get their own number series
`SGP-000001`, `SGP-000002`, … (worker passes stay `LGP-…`, material passes `GP-…`).

Database: `supabase/migrations/20261003120000_staff_gate_pass_roles.sql` (role)
and `20261003120100_staff_gate_pass.sql` (tables, functions, attendance trigger,
cron, staff photo). Rollback in `supabase/rollbacks/20261003120100_staff_gate_pass_down.sql`.

The screens are the same code as the worker passes: the pages, the Gate Check
panel and the dashboard cards live in `src/components/person-gate-pass/` and are
driven by a variant (`WORKER_PASS` / `STAFF_PASS` in `src/lib/personGatePass.ts`)
that carries the tables, roles, routes and wording.

## Pass kinds

| Kind | Meaning | What happens |
|---|---|---|
| **Half day** | The staff member leaves and does not come back today | When the guard scans them out, the date is marked **Half day** in HR attendance (see below) |
| **Short leave** | Personal errand: goes out and comes back, expected within N minutes (default 30) | Guard scans **Out**, later **In**. Out time, in time and minutes outside are recorded. Late return notifies HR and the approver. Still out at day end → **Not returned** and the day is marked Half day (setting, default on) |
| **Official duty** | Company work: purchases, bank, site visit. Expected within N minutes (default 180) | Guard scans **Out**, later **In**. A **destination** is recorded with the purpose. **Attendance is never touched.** Late return is information for HR, not a warning. Still out at day end → **Not scanned in**, no half day, HR informed |

Official duty was added in `20261004120000_staff_gate_pass_official_duty.sql`
(rollback `supabase/rollbacks/20261004120000_staff_gate_pass_official_duty_down.sql`).
Worker passes have the same kind (`docs/LABOUR_GATE_PASS.md`).

### Official duty: who raises it, who approves

- **HR** (`hr_manager`, `hr_officer`) and the approver raise it like any other kind,
  on New Staff Gate Pass.
- **The staff member themselves**, when their login is linked to their staff
  record (**Employees → Login user**). They use **Self Service → My Gate Passes**
  (`/my-gate-pass`), which needs no HR role: it shows only their own passes and
  lets them raise an official duty pass (never a half day or short leave). The
  database checks the link on every write (`employees.app_user_id`).
- **Field duty allowed** (switch on the Employees page) → the pass is **approved
  the moment it is raised** and logged as auto-approved; the staff member goes
  straight to the gate. Otherwise `staff_gate_pass_approver` approves as usual.
- The person who raised a pass can cancel it before it is scanned Out.
- Several trips a day are fine: once a trip is scanned In the day is free for
  the next pass.

## Flow

```
HR applies → pending approval → approver approves → approved → gate scan OUT → out
                                ↘ rejected                                    ↘ (short leave) gate scan IN → returned
cancel: the HR user who applied, or the approver, while pending / approved
expired:      approved (or still pending) but never scanned by day end
not returned: short leave still out at day end
```

- One live pass (pending / approved / out) per staff member per day, enforced by
  the database. A short leave that is back (`returned`) frees the day again.
- A pass can be applied for today or up to 7 days ahead. It is valid at the gate
  only on its date.
- **Day end** is the staff member's own duty end time from the Employees page,
  falling back to the global setting (18:00) when it is blank.

## Roles

| Role | Can |
|---|---|
| `hr_manager`, `hr_officer`, `staff_gate_pass_approver`, `super_admin` | Apply; cancel their own pass before it is out |
| `staff_gate_pass_approver` (new) | Approve / reject, cancel any pass before it is out, convert an overdue short leave to a half day. Lands on **Gate Pass Approvals** and sees only the staff gate pass pages |
| `gate_security`, `gate_pass_manager` | Scan Out / In on the Gate Check page |
| `hr_viewer` | Register read-only |
| `super_admin` | Everything, plus the settings |

Staff do not apply for themselves; HR applies on their behalf. The approver is a
separate role from the HR manager, as it is for workers.

Every write goes through the `staff_gate_pass_*` database functions, which
check these roles; the tables are read-only to the app.

## Pages (HR group)

| Page | Route | What it shows |
|---|---|---|
| Staff Gate Passes | `/hr/gate-pass` | Register (today by default), the four cards, **Outside now** (overdue in red), red **Old staff passes scanned again** card |
| New Staff Gate Pass | `/hr/gate-pass/new` | Staff picker with photo, kind, date, leaving time, expected minutes, reason, destination (official duty) |
| My Gate Passes | `/my-gate-pass`, `/my-gate-pass/new`, `/my-gate-pass/:id` | Self-service for the linked staff member: own passes, raise an official duty pass, pass page with QR |
| Pass page | `/hr/gate-pass/:id` | QR, printable slip, photo, timeline, approve / reject / cancel / convert |
| Gate Pass Approvals | `/hr/gate-pass/approvals` | Queue for the approver, plus short leaves overdue at the gate |
| Gate Check | `/gate-pass/check` | **Goods / vehicle**, **Worker** and **Staff** modes on the guard's existing page |
| HR Dashboard | `/hr/dashboard` | The four cards at the top and the rescan alerts |
| Employees | `/hr/employees` | Photo upload (`employees.photo_url`, bucket `staff-photos`) so the guard can match the person; **Login user** link and **Field duty allowed** switch |

### Company work report

The register (`/hr/gate-pass`) shows a **Company work** summary for the selected
dates whenever official duty passes went out: per staff member, trips, time
outside (still-out trips count up to now), passes not scanned in, and the
destinations. **Export Excel** writes two sheets, the summary and every trip.
Pick the month in the From / To filters for the monthly report.


## At the gate

The guard's Gate Check page has three modes. A scanned QR picks the mode by its
prefix (`GP-`, `LGP-`, `SGP-`); in Staff mode the guard can also type the staff
code to open today's approved pass. Worker and staff codes come from different
tables, so the modes stay separate.

The screen shows the staff member's **photo**, code, name, department,
designation, pass kind, date and who approved it. The guard compares the person
with the photo and taps **Staff member matches · Mark OUT** (or **Staff member
is back · Mark IN**).

- Only an `approved` pass for **today** can go out; only an `out` short leave
  for today can come in.
- The same guard tapping twice within 10 seconds gets the same answer, not a
  second exit.
- The guard never sees salary or any money.

### Old pass scanned again

Same as workers: opening a pass that was already used, closed, cancelled,
rejected, expired or for another date turns Gate Check red, sounds the siren
and vibrates the phone. Every attempt is logged (`rescan_attempt`); the
approver, the HR user who applied and the gate pass managers are notified at
most once per pass every 10 minutes. The register and the HR Dashboard show the
red card for the last 7 days; the pass page shows a red banner.

## Half day marking (HR attendance)

Staff attendance is one row per employee per day in `attendance`
(`present`, `absent`, `half_day`, `late`, `on_leave`), read by the Salary
Sheet, Attendance Sheet, Time Sheet and Punctuality Analytics. So:

- When a half-day pass goes **Out** (or a short leave becomes **Not
  returned**), `staff_gate_pass_mark_half_day` sets the attendance row of that
  staff member for that date to `half_day`, creating the row if there is none,
  fills `check_out` with the gate-out time where blank, and adds the remark
  "Left on gate pass SGP-…".
- A trigger on `attendance` keeps any row written later for that staff member
  and date at `half_day` — the Attendance page, the Excel import (which upserts
  by employee and date) and any other write alike.
- The **Salary Sheet** needs no change: a `half_day` row already counts as half
  a day unpaid and feeds the attendance-allowance rule, exactly as a half day
  entered by hand. The paid half-day leave quota is **not** touched; a gate pass
  half day is an attendance half day, as it is for workers.
- Attendance Sheet and Time Sheet show the pass number and gate-out time in the
  cell tooltip.
- The view `v_staff_gate_pass_half_days` lists these dates. An official duty
  pass never appears in it, even when it was not scanned back in.

There is no override: once the staff member is out on a half-day pass, that
date is a half day.

## Notifications (module `hr`, link to the pass page)

| Event | To |
|---|---|
| Applied | Approvers (and super admins) |
| Approved / rejected | The HR user who applied |
| Cancelled | Applicant and approvers (never the person who cancelled) |
| Out / In | Applicant (approvers too when the person is late) |
| Late back (expected + grace, default 15 min) | Applicant and approvers |
| Not returned at day end / expired | Applicant and approvers |
| Official duty: still out past expected, back late, not scanned in at day end | Applicant and HR managers, as **info** (never a warning, never the approver) |

A staff member who raised their own pass gets their notifications with the
`/my-gate-pass/…` link, which their login can open.
| Old pass scanned again | Approvers, applicant, gate pass managers |

## Scheduled job

`staff_gate_pass_tick()` runs every 5 minutes on pg_cron
(`staff-gate-pass-tick`): it sends the late-back notices and, after each staff
member's day end, closes the day (unused passes → `expired`, short leaves still
out → `not_returned` + half day). Passes for past dates are closed on the next
run whatever the time.

## Settings (`staff_gate_pass_settings`, super admin via `staff_gate_pass_settings_save`)

| Setting | Default |
|---|---|
| Default expected minutes for a short leave | 30 |
| Default expected minutes for official duty | 180 |
| Grace minutes before "late back" | 15 |
| Day-end time (Asia/Karachi), used when the staff member has no duty end time | 18:00 |
| Mark half day when not returned at day end | on |
