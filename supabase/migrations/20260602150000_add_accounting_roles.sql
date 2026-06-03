-- Graded accounting access roles (page-level tiers inside the Accounting module).
-- accounting_poster  : post entries + books/ledgers, no financial reports
-- accounting_officer : everything except Profit & Loss and Balance Sheet
-- accounting_manager : full accounting access incl. all reports + approve
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accounting_poster';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accounting_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accounting_manager';
