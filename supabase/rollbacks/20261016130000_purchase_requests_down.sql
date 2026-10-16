-- ============================================================================
-- Rollback of 20261016130000_purchase_requests.sql
-- ----------------------------------------------------------------------------
-- Drops the purchase request functions, tables (with every request, line,
-- event, department head and the settings row) and the number sequence.
-- Notifications already sent stay in the inbox.
-- ============================================================================

DROP FUNCTION IF EXISTS public.purchase_request_set_department_heads(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.purchase_request_settings_save(numeric);
DROP FUNCTION IF EXISTS public.purchase_request_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.purchase_request_final_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.purchase_request_purchase_review(uuid, boolean, text, jsonb);
DROP FUNCTION IF EXISTS public.purchase_request_hod_review(uuid, boolean, text, jsonb);
DROP FUNCTION IF EXISTS public.purchase_request_save(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.purchase_request_submit(uuid);
DROP FUNCTION IF EXISTS public.purchase_request_assert_head(uuid);
DROP FUNCTION IF EXISTS public.purchase_request_apply_lines(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.purchase_request_recalc(uuid);
DROP FUNCTION IF EXISTS public.purchase_request_notify(public.purchase_requests, text, text, text, text);
DROP FUNCTION IF EXISTS public.purchase_request_label(public.purchase_requests);
DROP FUNCTION IF EXISTS public.purchase_request_category_label(public.purchase_category);
DROP FUNCTION IF EXISTS public.purchase_request_log(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.purchase_request_can_purchase_approve(public.purchase_category);
DROP FUNCTION IF EXISTS public.purchase_request_is_dept_head(uuid);
DROP FUNCTION IF EXISTS public.purchase_request_is_super_admin();

DROP TABLE IF EXISTS public.purchase_request_events;
DROP TABLE IF EXISTS public.purchase_request_items;
DROP TABLE IF EXISTS public.purchase_requests;
DROP TABLE IF EXISTS public.purchase_request_department_heads;
DROP TABLE IF EXISTS public.purchase_request_settings;
DROP SEQUENCE IF EXISTS public.purchase_request_number_seq;
