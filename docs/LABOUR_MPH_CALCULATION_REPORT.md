# Labour MPH Calculation Report (department wise)

`/labour/mph-calculation-report?date=YYYY-MM-DD` · sidebar: Labour Productivity › MPH Calculation Report.
Who sees it: everyone with the labour module, plus the Production Coordinator. Read-only.

MPH Analysis gives one line per department. This report shows the working behind that line,
one production date at a time (default **yesterday**, the last day whose production is fully posted).

## Day report

For every department that had production or deployment on the date:

1. **A · Authorized MPH** — every posted production entry (item, sub-department, shift):
   output × the sub-department's MPH number (MPH Master), with sub-department subtotals, plus the
   department's fixed daily MPH on a day anyone was deployed.
2. **B · Used MPH** — every deployed worker (full list) grouped by process: shift and times, hours,
   full day (12) or half day (6).
3. **C · Result** — Authorized − Used = Net, efficiency, used MPH per unit against the standard
   (Σ output × MPH number ÷ output), and the MPH Loss Reasons state for a department in loss
   (not started / partly explained / reasons draft or submitted) with a link to the entry page.

Loss departments open by default; "Expand all" / "Collapse all" and a department filter are available.
**Print A4** prints a summary table and one block per department (workers grouped by process) with
signature lines. **Export Excel** gives three sheets: Summary, Authorized (items), Used (workers).

## Range report

Same calculation over a period (this month to date, last 7 days, last month, custom):

- department × day matrix of net MPH (click a day to open that day's report), with period totals;
- one department day by day: output, Σ output × MPH number, fixed MPH, authorized, workers,
  full / half split, used, net, efficiency, loss-reason state.

## Figures

All numbers come from `src/lib/mphLoss.ts` (`fetchMphDay`, `mphRateLookup`, `fixedDailyMph`), so they
agree with MPH Analysis and MPH Loss Reasons to 0.1 MPH. Overtime does not change MPH (12 maximum per
worker per day) and is not shown. Mockup that preceded the page:
`docs/mockups/labour-mph-calculation-report-mockup.html`.
