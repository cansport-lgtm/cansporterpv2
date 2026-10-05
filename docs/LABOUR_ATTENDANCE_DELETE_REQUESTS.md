# Labour Attendance Delete Requests (attendance marked by mistake)

Part of the Labour Productivity module. Requests get their own number series
`ADR-000001`, `ADR-000002`, …

Database: `supabase/migrations/20261006120000_labour_attendance_delete_roles.sql`
(role) and `20261006120100_labour_attendance_delete_requests.sql` (tables,
functions, trigger). Rollback in
`supabase/rollbacks/20261006120100_labour_attendance_delete_requests_down.sql`.

Screens: the **Request Delete** button and dialog on **Daily Entry**
(`src/pages/labour/LabourProductivityEntryPage.tsx`) and the
**Attendance Delete Requests** page
(`src/pages/labour/LabourAttendanceDeleteRequestsPage.tsx`, route
`/labour/attendance-delete-requests`). Shared helpers in
`src/lib/labourAttendanceDelete.ts`.

## The problem it solves

A worker's attendance for a day **is** the daily entry row in
`labour_productivity_targets` (one per worker / date / department / process; the
Attendance Sheet, Time Sheet and Labour Salary all read from it). Supervisors
post those rows but cannot delete them — only a super admin can.

When a supervisor marks a worker present by mistake (the worker was absent),
the supervisor now raises a **delete request with a reason**. The
**Labour Attendance Delete Approver** (or a super admin) approves it, which
deletes the entry, or rejects it with a note. Nothing is deleted until the
approval. Every step is written to a **log sheet**.

## Flow

```
supervisor: Daily Entry → row → Request Delete → reason → submit
      → pending ──approve──→ approved   (entry deleted, salary / sheets no longer count it)
                └──reject───→ rejected  (entry stays; note required)
                └──withdraw─→ cancelled (the supervisor who raised it, or an approver)
super admin deletes the entry directly while a request is pending
      → request closed as approved ("Entry deleted directly by …"), logged as such
```

- One pending request per entry (enforced by the database). The Daily Entry row
  shows **Delete request pending** instead of the button while one is open.
- A request can be raised on a **draft or an approved (locked)** entry.
- The reason must be at least 5 characters. Rejection needs a note. Approval
  notes are optional.
- The request stores a **full snapshot** of the entry (worker, date,
  department, process, full/half day, MPH, check in/out, quantities, who marked
  it and when, plus the raw row as JSON), so the record is complete after the
  row is gone.
- The approvers are notified when a request is raised; the supervisor is
  notified of the decision (system notifications, link to the requests page).
- Deleting the entry still goes through the central audit trail
  (`audit_log`), attributed to the approver.

## Roles

| Role | Can |
|---|---|
| `floor_incharge`, `labour_productivity_poster`, `labour_productivity_approver` (and `admin`, `manager`, `supervisor`, `operational_manager`) | Raise a delete request from Daily Entry; open the requests page; withdraw their own pending request |
| `labour_attendance_delete_approver` (new) | Approve (deletes the entry) / reject / withdraw any pending request; see all requests and the log sheet. Lands on **Attendance Delete Requests** and sees only that page |
| `super_admin` | Everything above, and may still delete an entry directly (a pending request on it is then closed and logged) |

`labour_productivity_approver` approves **edit** requests but not **delete**
requests — a separate role was asked for so deletion sits with one accountable
person. Give both roles to the same user if that is wanted.

Assign the role in **Settings → Users**. It is a strict-locked role: a user who
holds it plus a flexible role still only sees the requests page (same
treatment as the gate pass approvers).

## Pages

### Daily Entry (`/labour/entry`)

Every non-super-admin row gets a red **Request Delete** icon (desktop) / button
(mobile). The dialog shows the entry (worker, date, department, process,
attendance, times, status, who marked it) and asks for the reason. Super admins
keep their direct **Delete**.

### Attendance Delete Requests (`/labour/attendance-delete-requests`)

| Tab | Shows |
|---|---|
| **Pending** | Open requests. Approvers see **Approve** / **Reject** / **Cancel**; a supervisor sees **Cancel** on their own requests |
| **History** | Approved / rejected / cancelled requests with reviewer, time and notes. Filters: status, requester, attendance date range, search. Excel export |
| **Log Sheet** | Every event (submitted, approved — attendance deleted, rejected, cancelled, entry deleted directly) with the worker, attendance date, department / process, attendance, reason, notes and who did it. Filters: event, logged date range, search. Excel export |

## Database

### Tables

`labour_attendance_delete_requests` — one row per request: `request_number`,
`entry_id` (plain uuid, **not** a foreign key — the row it points to is deleted
on approval), the entry snapshot columns + `entry_snapshot jsonb`, `reason`,
`status` (`pending` / `approved` / `rejected` / `cancelled`), requester,
reviewer, `review_notes`, `entry_deleted_at`. Unique partial index: one
`pending` per `entry_id`.

`labour_attendance_delete_log` — the log sheet, one row per event
(`submitted`, `approved`, `rejected`, `cancelled`, `entry_deleted`),
denormalised with the worker / date / department / process / attendance,
reason, notes, `acted_by` + name and `details jsonb`.

Both tables are **read-only to clients** (SELECT for everyone with a login).
Writes happen only in the SECURITY DEFINER functions, which resolve the acting
user from the `x-app-user-id` header (`app_user_id()`) and check roles in
`user_roles`.

### Functions

| Function | Who | Does |
|---|---|---|
| `labour_attendance_delete_request(entry_id, reason)` → uuid | request roles | Validates, snapshots the entry, inserts the request, logs `submitted`, notifies approvers |
| `labour_attendance_delete_review(id, approve, notes)` → status | approve roles | Approve: marks approved, deletes the entry, logs `approved`. Reject: requires notes, logs `rejected`. Notifies the requester |
| `labour_attendance_delete_cancel(id, reason)` | requester or approve roles | Marks `cancelled`, logs it |
| `labour_attendance_delete_can(action)` → bool | — | `request` / `approve` role check |

Trigger `labour_attendance_delete_on_entry_delete` (AFTER DELETE on
`labour_productivity_targets`): closes any pending request for the deleted row
as approved with the note "Entry deleted directly by …", logs `entry_deleted`
and tells the requester. The review function marks the request approved
**before** deleting, so its own delete does not trip this trigger.
