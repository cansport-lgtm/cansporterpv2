# Labour Salary Viewer (labour cash handler)

Role: `labour_salary_viewer` — Labour Productivity module, special tier.

Give this role to the person who disburses labour cash. It is read-only and
confined to one page.

## What the role can do

- Open **Labour Productivity → Labour Salary** (`/labour/salary`) and lands
  there after login.
- Pick a month, search, filter by department, open a payslip.
- Print All, Export Excel, Print Salary List, Print Payment Vouchers.
- See both locked and unlocked months.

## What the role cannot do

- Add or adjust overtime, advances, travel advances or attendance allowances
  (the row buttons are hidden — `canEditSalary` in `LabourSalaryPage`).
- Lock or unlock a month, or use the date-range filter (super admin only).
- Reach any other Labour Productivity page. The sidebar shows only Labour
  Salary and direct URLs redirect (route whitelist in `AuthContext`).

## Enforcement

- Migration `20261126120000_labour_salary_viewer_role.sql` adds the enum value.
- `AuthContext`: module access `labour`, route whitelist `/labour/salary`,
  listed in both the restricted and strict-locked role sets so a flexible role
  the same user also holds cannot widen it; labour permission is `view` only.
- The salary tables keep their existing open row-level security, as for the
  other labour roles — the restriction is enforced in the app.
