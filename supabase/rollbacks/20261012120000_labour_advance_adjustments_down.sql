-- Rollback for 20261012120000_labour_advance_adjustments.sql
-- Removes the guard trigger, the delete-with-reason function, the lock
-- helper and the three adjustment columns from both advance tables. The
-- tables go back to being open to every operation (UI-only control).

DROP TRIGGER IF EXISTS labour_advance_guard ON public.labour_advances;
DROP TRIGGER IF EXISTS labour_advance_guard ON public.labour_travel_advances;
DROP FUNCTION IF EXISTS public.labour_advance_delete(TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.labour_advance_guard();
DROP FUNCTION IF EXISTS public.labour_advance_month_locked(DATE);

ALTER TABLE public.labour_advances
  DROP COLUMN IF EXISTS adjustment_reason,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS updated_at;

ALTER TABLE public.labour_travel_advances
  DROP COLUMN IF EXISTS adjustment_reason,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS updated_at;
