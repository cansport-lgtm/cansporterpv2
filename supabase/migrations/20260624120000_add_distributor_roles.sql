-- Distributor Order Management module — new roles.
-- Three roles power a self-contained module given to external distributors:
--   • distributor_sales   — reps who create orders & customers for their distributor
--   • distributor_manager — approves/rejects/edits submitted orders, sees all of
--                           their distributor's data, runs the dispatch sheet
--   • distributor_admin   — manages their own distributor's sales/manager users
-- Each value is added in its own migration (separate transaction) because a new
-- enum value cannot be referenced in the same transaction that creates it.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'distributor_sales';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'distributor_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'distributor_admin';
