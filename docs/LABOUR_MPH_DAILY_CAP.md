# Labour MPH: 12 per worker per day

A productivity entry's MPH comes from its work type: **full day = 12**, **half day = 6**.
A worker may have several entries on one date (two half days in two departments, for
example), but together they can never pass **12 MPH**.

## Where it is enforced

The database refuses any new or changed entry that would take the worker's total for
that date above 12 (trigger `labour_productivity_mph_cap`, migration
`20261102120000_labour_mph_daily_cap.sql`). That covers every way an entry is written:
the entry form, edit-request approval, Excel import and the Overtime dialog. The
refusal names the entries the worker already has, for example:

> Worker 423 SAQIB YASEEN already has Quality Department 12 MPH on 16 Oct 2026. This
> would make 18 MPH - maximum is 12 MPH per day. Remove or change the other entry first.

To move a worker from one department to another for the whole day, delete (or ask to
delete) the old entry first, then change or add the full day.

## Why it was added (Oct 2026)

- **16 Oct 2026, worker 423:** two half days in Fancy Final (12 MPH). An edit request
  turned one of them into a 12 MPH full day in Quality; the other 6 MPH stayed, so the
  day showed 18 MPH. Only the entry form checked the limit; approval did not.
- **11 "overtime only" entries (Feb, Apr, Jun 2026):** the Overtime dialog looked up the
  month's entries up to day "31". Postgres refuses `2026-04-31`, so in 30-day months and
  February the lookup failed, the dialog found no entry, and it added a second full day
  (12 MPH) beside the real one. The dialog now uses the real month end and checks the
  date in the database before adding anything.

The migration cleaned up those days: overtime amounts were moved onto the worker's real
entry for the day (salary unchanged: pay counts at most one day per date and adds up
overtime), and the leftover draft on 27 Apr 2026 (worker 66) was deleted.
