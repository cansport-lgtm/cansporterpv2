-- Rollback for 20260926120000_grade_stage_ledger.sql
-- Drops the grade-wise stage ledger. production_entries is not touched by the
-- forward migration, so nothing there needs restoring. This DELETES the
-- opening balances, adjustments, regrade requests and packing transfers.

DROP FUNCTION IF EXISTS public.grade_packing_transfer_delete(uuid);
DROP FUNCTION IF EXISTS public.grade_packing_transfer_add(date, uuid, numeric, text);
DROP FUNCTION IF EXISTS public.grade_regrade_cancel(uuid);
DROP FUNCTION IF EXISTS public.grade_regrade_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.grade_regrade_request(date, text, uuid, uuid, numeric, text);
DROP FUNCTION IF EXISTS public.grade_ledger_add_adjustment(date, text, uuid, numeric, text, text);
DROP FUNCTION IF EXISTS public.grade_ledger_save_openings(jsonb);
DROP FUNCTION IF EXISTS public.grade_ledger_save_settings(date, date, boolean);
DROP FUNCTION IF EXISTS public.grade_ledger_check_out(text, uuid, date, numeric);
DROP FUNCTION IF EXISTS public.grade_ledger_is_super_admin();
DROP FUNCTION IF EXISTS public.grade_ledger_available(text, uuid, date, uuid);
DROP FUNCTION IF EXISTS public.grade_ledger_balance(text, uuid, date);
DROP FUNCTION IF EXISTS public.grade_ledger_summary(date, date);
DROP FUNCTION IF EXISTS public.grade_ledger_movements(date, date, text, uuid);

DROP VIEW IF EXISTS public.v_grade_ledger_movements;

DROP TABLE IF EXISTS public.grade_packing_transfers;
DROP TABLE IF EXISTS public.grade_regrade_requests;
DROP SEQUENCE IF EXISTS public.grade_regrade_request_seq;
DROP TABLE IF EXISTS public.grade_ledger_adjustments;
DROP TABLE IF EXISTS public.grade_ledger_openings;
DROP TABLE IF EXISTS public.grade_ledger_settings;
