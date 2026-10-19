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
