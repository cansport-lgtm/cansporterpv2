-- Rollback for 20260929120000_gate_pass_phase2_3.sql
-- Removes returnable / job work / scrap / backfill support and restores the
-- Phase 1 functions. Run only when no pass of those types exists (the
-- Phase 1 CHECK constraints still allow the type names, but their columns and
-- tables go). Left as they are: stock_movements rows already posted, the two
-- inventory_locations rows, spare_parts stock changes, and the photo bucket.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gate-pass-overdue';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.gate_pass_settings_save(integer, numeric);
DROP FUNCTION IF EXISTS public.gate_pass_book_spoil(uuid, integer, text);
DROP FUNCTION IF EXISTS public.gate_pass_book_save(uuid, text, integer, integer, text, boolean);
DROP FUNCTION IF EXISTS public.gate_pass_scrap_in(uuid, numeric, date, text);
DROP FUNCTION IF EXISTS public.gate_pass_scrap_set_opening(uuid, numeric, date);
DROP FUNCTION IF EXISTS public.gate_pass_scrap_category_save(uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.gate_pass_notify_overdue();
DROP FUNCTION IF EXISTS public.gate_pass_close(uuid, text);
DROP FUNCTION IF EXISTS public.gate_pass_receive(uuid, date, jsonb, text);
DROP FUNCTION IF EXISTS public.gate_pass_scrap_weigh(uuid, jsonb, text, text, text);

-- Put the Phase 1 gate check and release back under their own names.
DROP FUNCTION IF EXISTS public.gate_pass_gate_check(uuid, jsonb, text, text);
ALTER FUNCTION public.gate_pass_gate_check_count(uuid, jsonb, text, text) RENAME TO gate_pass_gate_check;
DROP FUNCTION IF EXISTS public.gate_pass_release(uuid, text);
ALTER FUNCTION public.gate_pass_release_counted(uuid, text) RENAME TO gate_pass_release;
GRANT EXECUTE ON FUNCTION public.gate_pass_gate_check(uuid, jsonb, text, text), public.gate_pass_release(uuid, text)
  TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.gate_pass_build_scrap(uuid, jsonb);
DROP FUNCTION IF EXISTS public.gate_pass_build_goods(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.gate_pass_move(text, uuid, uuid, numeric, uuid, uuid, date, public.gate_passes, text);
DROP FUNCTION IF EXISTS public.gate_pass_line_balance(uuid);
DROP FUNCTION IF EXISTS public.gate_pass_location(text);
DROP FUNCTION IF EXISTS public.gate_pass_scrap_balance(uuid);
DROP FUNCTION IF EXISTS public.gate_pass_is_super_admin();

DROP VIEW IF EXISTS public.v_gate_pass_book_serials;
DROP VIEW IF EXISTS public.v_gate_pass_open_lines;
DROP VIEW IF EXISTS public.v_scrap_yard_balance;

DROP TABLE IF EXISTS public.gate_pass_receipt_items;
DROP TABLE IF EXISTS public.gate_pass_receipts;
DROP SEQUENCE IF EXISTS public.gate_pass_receipt_number_seq;
DROP TABLE IF EXISTS public.gate_pass_weighments;
DROP TABLE IF EXISTS public.gate_pass_scrap_rates;

ALTER TABLE public.gate_pass_items
  DROP COLUMN IF EXISTS item_id, DROP COLUMN IF EXISTS machine_id, DROP COLUMN IF EXISTS fixed_asset_id,
  DROP COLUMN IF EXISTS spare_part_id, DROP COLUMN IF EXISTS scrap_category_id, DROP COLUMN IF EXISTS estimated_quantity,
  DROP COLUMN IF EXISTS expected_output_product_id, DROP COLUMN IF EXISTS expected_output_item_id,
  DROP COLUMN IF EXISTS expected_output_description, DROP COLUMN IF EXISTS wastage_quantity;
ALTER TABLE public.gate_passes
  DROP COLUMN IF EXISTS expected_return_date, DROP COLUMN IF EXISTS process_name,
  DROP COLUMN IF EXISTS weighbridge_photo_path, DROP COLUMN IF EXISTS is_backfill, DROP COLUMN IF EXISTS book_id,
  DROP COLUMN IF EXISTS book_serial, DROP COLUMN IF EXISTS paper_datetime, DROP COLUMN IF EXISTS paper_photo_path,
  DROP COLUMN IF EXISTS backfill_reason, DROP COLUMN IF EXISTS closed_by, DROP COLUMN IF EXISTS closed_at,
  DROP COLUMN IF EXISTS close_reason;

DROP TABLE IF EXISTS public.gate_pass_book_spoiled;
DROP TABLE IF EXISTS public.gate_pass_books;
DROP TABLE IF EXISTS public.gate_pass_scrap_entries;
DROP TABLE IF EXISTS public.gate_pass_scrap_categories;
DROP TABLE IF EXISTS public.gate_pass_settings;

-- Restore the Phase 1 save / submit / mark-out: re-run these sections of
-- 20260928120100_gate_pass.sql after this file:
--   gate_pass_save, gate_pass_submit, gate_pass_mark_out(uuid)
DROP FUNCTION IF EXISTS public.gate_pass_mark_out(uuid, timestamptz);
