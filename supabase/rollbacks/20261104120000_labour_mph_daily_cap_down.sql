-- Rollback for 20261104120000_labour_mph_daily_cap.sql
-- Removes the 12 MPH per day rule. The clean-up of the old over-limit days
-- (overtime folded into the real entry, leftover drafts deleted) stays.

DROP TRIGGER IF EXISTS labour_productivity_mph_cap ON public.labour_productivity_targets;
DROP FUNCTION IF EXISTS public.labour_productivity_mph_cap();
