-- Rollback for 20261005120000_gate_inward.sql
-- Drops the Gate Inward tables, functions, views and the GRN triggers, and the
-- gate_inward_id columns on goods_receipt_notes / gate_pass_receipts. Entries
-- and their audit rows are lost; GRNs and receipts are untouched otherwise.

DROP TRIGGER IF EXISTS trg_gate_inward_after_grn ON public.goods_receipt_notes;
DROP TRIGGER IF EXISTS trg_gate_inward_check_grn ON public.goods_receipt_notes;
DROP FUNCTION IF EXISTS public.gate_inward_after_grn();
DROP FUNCTION IF EXISTS public.gate_inward_check_grn();

DROP FUNCTION IF EXISTS public.gate_inward_settings_save(jsonb);
DROP FUNCTION IF EXISTS public.gate_inward_log_rescan(uuid);
DROP FUNCTION IF EXISTS public.gate_inward_attach_receipt(uuid, uuid);
DROP FUNCTION IF EXISTS public.gate_inward_close(uuid, text);
DROP FUNCTION IF EXISTS public.gate_inward_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.gate_inward_reject(uuid, text);
DROP FUNCTION IF EXISTS public.gate_inward_vehicle_out(uuid);
DROP FUNCTION IF EXISTS public.gate_inward_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.gate_inward_open_passes(text);
DROP FUNCTION IF EXISTS public.gate_inward_suppliers();
DROP FUNCTION IF EXISTS public.gate_inward_open_pos(uuid);
DROP FUNCTION IF EXISTS public.gate_inward_kind_label(text);
DROP FUNCTION IF EXISTS public.gate_inward_notify(public.gate_inward_entries, text, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.gate_inward_log(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.gate_inward_can(text);

DROP VIEW IF EXISTS public.v_purchase_order_gate_inward;
DROP VIEW IF EXISTS public.v_gate_inward_register;

DROP INDEX IF EXISTS public.gate_pass_receipts_gate_inward_idx;
ALTER TABLE public.gate_pass_receipts DROP COLUMN IF EXISTS gate_inward_id;
DROP INDEX IF EXISTS public.goods_receipt_notes_gate_inward_idx;
ALTER TABLE public.goods_receipt_notes DROP COLUMN IF EXISTS gate_inward_id;

DROP TABLE IF EXISTS public.gate_inward_events;
DROP TABLE IF EXISTS public.gate_inward_settings;
DROP TABLE IF EXISTS public.gate_inward_entries;
DROP SEQUENCE IF EXISTS public.gate_inward_number_seq;
