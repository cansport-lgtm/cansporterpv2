# MPH Loss Reasons

MPH Analysis compares, per department and day, **Authorized MPH** (production
output × MPH number) with **Used MPH** (labour deployed). A negative net is a
loss. This feature records **why** each loss happened.

## Pages

| Page | Route | Who |
|---|---|---|
| Reason master | `/master/mph-loss-reasons` | Super admin only (add / edit / deactivate / delete unused) |
| MPH Loss Reasons (entry + print) | `/labour/mph-loss-reasons?date=YYYY-MM-DD` | Production Coordinator and super admin edit; other labour roles view |
| MPH Loss Reason Analysis | `/labour/mph-loss-analysis` | Same as above (view) |

## SOP (daily)

1. Production entries for day D are **posted** (Production → Daily Entry).
2. The first posted entry for D opens the day's report and notifies every
   **Production Coordinator** ("MPH loss reasons due"). The link opens the
   entry page for D.
3. The coordinator picks one or more reasons for each department in loss, with
   MPH lost, workers affected and remarks. Only reasons mapped to that
   department appear in the dropdown. **Save Draft** at any time.
4. **Submit Reasons** is allowed only when every department's reasons add up
   to its loss (±0.05 MPH). Submitting notifies super admins and locks the report.
5. **Print** gives the A4 MPH Loss Reason Report (department-wise reasons,
   summary by reason, signature lines).
6. If production for D is posted again after submission, the report is flagged
   and the coordinator + super admins are notified. A super admin can
   **Reopen** a submitted report for correction.
7. Weekly review uses the Reason Analysis page (MPH lost by reason, daily loss,
   department × reason matrix, reason log).

## Calculation panel and phone layout

Every department on the entry page can show the calculation behind its numbers
("Show calculation" on desktop, the **Calculation** button on a phone):

1. **Authorized MPH, item by item** — every posted production entry (grade,
   sub-department, shift): output × the sub-department's MPH number, with
   sub-department subtotals and the department total.
2. **Used MPH, worker by worker** — every worker from Today's Deployment,
   grouped by process, with hours and MPH.
3. **Result** in plain words: earned vs used, MPH lost, MPH per unit against
   the standard.

Below 768px the page becomes a phone flow: an overview list of departments in
loss (tap one), a department screen with stacked reason cards, a bottom-sheet
reason picker (search, category chips, "used today" first), a "Use remaining"
shortcut, and sticky Save / Submit buttons. Desktop (≥768px) keeps the original
layout.

## Entry issues (labour deployed, 0 MPH earned)

A department that used labour but earned nothing is usually an entry problem,
not a real loss. The form flags it instead of asking for an ordinary reason.

| Flag | When | Likely cause shown |
|---|---|---|
| No production entered | Workers deployed, output 0, workers reported a quantity in Labour Productivity Entry | Production entry missing in Daily Entry |
| No production entered | Workers deployed, output 0, workers reported no quantity | Check the deployment (workers may be on the wrong department) |
| MPH number not set | Output entered, but the sub-department has no MPH number | Set the MPH number in MPH Master |

Departments on a fixed daily MPH (below) are never flagged.

What the coordinator sees:

- A red banner listing the flagged departments, and a "From entry issues" tile
  showing how much of the day's loss they make up.
- On each flagged department: the likely cause, what the entries show, and a
  **Request production entry** button (one request per department and date).
  It notifies the production roles; for "check the deployment" also the labour
  productivity poster and approver; for a missing MPH number, super admins.
  Super admins also get direct links to Daily Entry, the deployment sheet and
  MPH Master.
- Reasons are **locked** for a flagged department and **Submit is blocked**
  (on the form and in `mph_loss_report_save`) until one of these happens:
  1. The entry is fixed. The figures refresh and the flag clears.
  2. The coordinator ticks **Confirmed: no production this day**. Only reasons
     in the **No production** category can then be picked, and remarks are
     required. Who confirmed and when is saved with the report and printed.
     Not available for "MPH number not set", because output exists.

"No production" reasons are seeded (shutdown, full-day breakdown, no order,
no material, utility failure, maintenance / cleaning) and are editable on the
reason master. They do not appear for ordinary losses.

The print has an "Entry issues" section above the department-wise reasons.
Reason Analysis shows the loss from entry issues separately (tile, stacked
daily chart, entry issue log). Reports saved before this feature carry no
flag, so the split starts from go-live.

Migration: `supabase/migrations/20261122120000_mph_entry_issue_flags.sql`
(rollback in `supabase/rollbacks/`). Until it is applied the form still shows
the flags, but the database does not enforce them and the request button fails.

## Fixed daily MPH (departments with no output)

Authorized MPH is earned from output, so a department that produces nothing
countable — housekeeping, security, store — earned 0 and its whole deployment
showed as a loss every day, explained with a made-up reason.

MPH Master (`/production/mph-master`) now takes a **Fixed MPH per day** on the
department-level row (sub-department "None"), with an optional **Applies from**
date. Housekeeping: MPH number 0, fixed 12 per day.

Rules (`src/lib/mphLoss.ts`, used by every page that computes Authorized —
MPH Analysis, MPH Management, Loss Reasons, CEO Dashboard, Deployment Analysis,
Today's Target and the deployment Excel export):

- Authorized = Σ output × MPH number **+** fixed daily MPH.
- The fixed MPH counts only on a date where the department has at least one
  deployed worker. A day nobody is deployed earns nothing.
- It is a flat figure per day, not per worker. One housekeeper (12 MPH used)
  nets 0; two (24 used) net −12, which still has to be explained.
- It applies from the "Applies from" date. Set that to the go-live date so
  earlier days keep the figures their reports were saved with (the calculation
  panel flags a saved report whose live figures differ).
- Only department-level rows can carry it; the database refuses it on
  sub-department rows.

The entry page shows "(incl. 12.0 fixed daily)" next to Authorized and a
"+ Fixed daily allowance" line under the item table.

After go-live, deactivate any catch-all reason that was being used for this
("mph set nahi hai …") on the reason master.

Migration: `supabase/migrations/20261116120000_mph_fixed_daily_allowance.sql`
(rollback in `supabase/rollbacks/`).

## Role

`production_coordinator` (Labour module, special tier). Confined to the MPH loss
reason pages and MPH Analysis; lands on `/labour/mph-loss-reasons` after login.
Assign it from user management like any other role.

## Database

- `20261102120000_production_coordinator_role.sql` — the role.
- `20261102120100_mph_loss_reasons.sql` — tables, seed reasons, the
  `mph_loss_report_save` / `mph_loss_report_reopen` functions and the
  production-posted trigger.
- Rollback: `supabase/rollbacks/20261102120100_mph_loss_reasons_down.sql`.

The reason master starts with eight reasons that apply to all departments;
narrow them per department on the master page.
