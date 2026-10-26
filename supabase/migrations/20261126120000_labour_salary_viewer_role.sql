-- ============================================================================
-- Labour Salary Viewer role
-- ----------------------------------------------------------------------------
--   labour_salary_viewer → read-only access to the Labour Salary page, for the
--                          person who handles labour cash (disburses salaries).
--
-- Sees the monthly salary sheet, payslips, salary list, payment vouchers and
-- Excel export. Cannot add overtime / advances / allowances, cannot lock or
-- unlock a month, and reaches no other Labour Productivity page. Confined in
-- the app (route whitelist + strict lockdown), like the other labour roles.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'labour_salary_viewer';
