-- Rollback for 20261125120000_grade_ledger_edit_adjustment.sql
DROP FUNCTION IF EXISTS public.grade_ledger_edit_adjustment(uuid, date, text, uuid, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.grade_ledger_min_balance(text, uuid, date);
DROP TABLE IF EXISTS public.grade_ledger_adjustment_history;
ALTER TABLE public.grade_ledger_adjustments
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS edit_count;
