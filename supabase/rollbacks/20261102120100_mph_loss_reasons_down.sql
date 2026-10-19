-- Rollback for 20261102120100_mph_loss_reasons.sql.
-- The production_coordinator enum value stays (Postgres can't drop enum values);
-- with no tables or functions using it, it is harmless.

DROP TRIGGER IF EXISTS trg_mph_loss_on_production_posted ON public.production_entries;
DROP FUNCTION IF EXISTS public.mph_loss_on_production_posted();
DROP FUNCTION IF EXISTS public.mph_loss_report_reopen(uuid);
DROP FUNCTION IF EXISTS public.mph_loss_report_save(date, jsonb, jsonb, boolean);
DROP FUNCTION IF EXISTS public.mph_loss_can_edit();

DROP TABLE IF EXISTS public.mph_loss_report_lines;
DROP TABLE IF EXISTS public.mph_loss_report_departments;
DROP TABLE IF EXISTS public.mph_loss_reports;
DROP TABLE IF EXISTS public.mph_loss_reason_departments;
DROP TABLE IF EXISTS public.mph_loss_reasons;

DROP SEQUENCE IF EXISTS public.mph_loss_report_seq;
DROP SEQUENCE IF EXISTS public.mph_loss_reason_code_seq;
