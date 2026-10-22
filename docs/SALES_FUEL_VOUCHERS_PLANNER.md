# Private Label Sales: fuel vouchers (price × factor) and the Salesman Planner

Mockup: `docs/mockups/salesman-planner-fuel-voucher-mockup.html`.
Migration: `supabase/migrations/20261112120000_sales_fuel_rate_factor_planner.sql`
(rollback in `supabase/rollbacks/`). Code: `src/lib/salesFuel.ts`,
`src/lib/salesmanPlanner.ts`, `src/pages/sales/SalesFuelTripsPage.tsx`,
`src/pages/sales/SalesFuelPricesPage.tsx`, `src/pages/sales/SalesmanPlannerPage.tsx`.

## Fuel trip voucher

**Private Label Sales → Fuel Trips** (`/sales/fuel/trips`). The salesman posts a
trip with the start and end odometer and **today's petrol price** (Rs per
litre, pre-filled with the price they typed last time, else the super admin's
price list). Posting is refused without a price or when no factor is set for
the trip date. (Meter photo upload was built and then removed at the user's
request; the `odo_start_photo_url` / `odo_end_photo_url` columns stay unused.)

```
rate per km = petrol price (salesman) × multiplying factor (super admin)
amount      = km × rate per km
```

The trigger `sales_fuel_trip_snapshot` freezes `fuel_price_snapshot`,
`rate_factor_snapshot`, `rate_per_km` and `amount` on the row when the trip is
posted (and re-prices on edits until the trip is approved onto a payout or
Paid). Each trip gets a voucher number `SFV-YY-0001 …`. A later factor change
never moves a posted voucher.

When no factor exists for the date the old formula (km ÷ vehicle mileage ×
price) is used so nothing is left unpaid; the form warns and blocks new
posts until the super admin sets one.

**Printing.** The voucher prints straight after posting and from the Print
icon on each row. One voucher prints twice on one A4 page (Accounts copy +
Salesman copy, cut line between). Ticking several rows and pressing *Print N
vouchers* pairs them two to a page, each as the Accounts copy.

**Who does what.** Salesmen post their own trips (the salesperson field is
locked to them); super admin, admin, manager and `private_label_manager` may
post for anyone and approve or reject. Weekly payouts are unchanged.

## Multiplying factor (super admin)

**Private Label Sales → Fuel Prices & Factor** (`/sales/fuel/prices`,
super admin only). Table `sales_fuel_rate_factors`: one row per change with
an effective date, so the history is kept. The factor in force on a trip date
is the newest row with `effective_date <= trip_date`. Example: bikes doing
10 km per litre → factor 0.1000 → Rs 272.50/L pays Rs 27.25 per km.

The fuel price list on the same page is now only the default for a
salesman's first trip.

## Salesman Planner

**Private Label Sales → Salesman Planner** (`/sales/planner`). Table
`sales_salesman_plans`, numbered `PLN-YY-0001 …`. A plan is for a **single
day** (default), a **week** (Monday–Saturday of the chosen date) or custom
dates. The body is free text, one line per point: a line starting with `-`,
`•` or `*` is a bullet; any other line is a heading (a day, a city, morning /
afternoon). Save as draft or submit; print one plan per A4 page with
signature lines. Salesmen see and edit their own drafts; managers (as above)
see every plan.
