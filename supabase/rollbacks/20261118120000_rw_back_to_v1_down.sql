-- ============================================================================
-- DOWN-migration for 20261118120000_rw_back_to_v1
-- ----------------------------------------------------------------------------
-- Not in supabase/migrations on purpose: it must never run automatically.
--
-- The up-migration dropped the R&W ball-inventory and downgrade objects after
-- copying their tables into the rw_archive schema. Bringing them back is two
-- steps:
--
--   STEP 1 (manual). Re-run, in this order, the migrations that build the
--   objects. All are written to be re-runnable:
--     20260830120000_rw_ball_inventory_phase1.sql
--     20260830130000_rw_defect_output_grades.sql
--     20260905130000_rw_track_by_grade.sql
--     20260923120000_rw_isolate_from_production.sql
--     20261022120000_rw_downgrades.sql
--   and the rw_locations / rw_defect_grades part of
--     20261021120000_auto_master_codes.sql (series rows + trg_00_auto_code).
--   The frontend screens come back from git (the commit before this change).
--
--   STEP 2 (this file). Reload the archived rows and restore the masters.
--
-- Run STEP 2 only after STEP 1. Once the restore is verified, drop the rw_archive
-- schema, so that re-applying the up-migration later archives afresh.
-- ============================================================================
BEGIN;

-- Posting triggers must not fire while history is reloaded: the ledger and
-- stock rows are restored as they were, not re-derived.
ALTER TABLE public.rw_checker_entries DISABLE TRIGGER USER;
ALTER TABLE public.rw_checker_entry_intervals DISABLE TRIGGER USER;
ALTER TABLE public.rw_ball_ledger DISABLE TRIGGER USER;
ALTER TABLE public.rw_locations DISABLE TRIGGER USER;
ALTER TABLE public.rw_defect_grades DISABLE TRIGGER USER;
ALTER TABLE public.rw_downgrades DISABLE TRIGGER USER;

-- The rebuild migrations seed these masters; the archive is the truth.
TRUNCATE public.rw_downgrades, public.rw_department_defect_grades, public.rw_defect_rates,
         public.rw_ball_stock, public.rw_ball_ledger,
         public.rw_checker_entry_intervals, public.rw_checker_entries,
         public.rw_defect_grades, public.rw_locations CASCADE;

-- Parents first. Generated columns (e.g. rw_downgrades.cost_loss) are left out
-- so the database recomputes them.
DO $$
DECLARE t text; cols text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rw_locations', 'rw_defect_grades', 'rw_department_defect_grades', 'rw_defect_rates',
    'rw_checker_entries', 'rw_checker_entry_intervals',
    'rw_ball_ledger', 'rw_ball_stock', 'rw_downgrades'
  ] LOOP
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) INTO cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = t AND c.is_generated = 'NEVER'
       AND EXISTS (SELECT 1 FROM information_schema.columns a
                    WHERE a.table_schema = 'rw_archive' AND a.table_name = t
                      AND a.column_name = c.column_name);
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM rw_archive.%I', t, cols, cols, t);
  END LOOP;
END $$;

-- Continue the downgrade numbering after the restored forms.
SELECT setval('public.rw_downgrade_seq',
              GREATEST((SELECT count(*) FROM public.rw_downgrades), 1));

ALTER TABLE public.rw_checker_entries ENABLE TRIGGER USER;
ALTER TABLE public.rw_checker_entry_intervals ENABLE TRIGGER USER;
ALTER TABLE public.rw_ball_ledger ENABLE TRIGGER USER;
ALTER TABLE public.rw_locations ENABLE TRIGGER USER;
ALTER TABLE public.rw_defect_grades ENABLE TRIGGER USER;
ALTER TABLE public.rw_downgrades ENABLE TRIGGER USER;

-- Masters: put back what the up-migration removed or renamed.
INSERT INTO public.rw_reasons
SELECT (jsonb_populate_record(NULL::public.rw_reasons, row_data)).*
  FROM rw_archive.removed_masters WHERE source_table = 'rw_reasons' AND action = 'deleted'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rw_units
SELECT (jsonb_populate_record(NULL::public.rw_units, row_data)).*
  FROM rw_archive.removed_masters WHERE source_table = 'rw_units' AND action = 'deleted'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rw_dispositions
SELECT (jsonb_populate_record(NULL::public.rw_dispositions, row_data)).*
  FROM rw_archive.removed_masters WHERE source_table = 'rw_dispositions' AND action = 'deleted'
ON CONFLICT (id) DO NOTHING;

UPDATE public.rw_dispositions d SET name = m.row_data->>'name'
  FROM rw_archive.removed_masters m
 WHERE m.source_table = 'rw_dispositions' AND m.action LIKE 'renamed%'
   AND d.id = (m.row_data->>'id')::uuid;

UPDATE public.rw_reasons r SET is_active = true FROM rw_archive.removed_masters m
 WHERE m.source_table = 'rw_reasons' AND m.action = 'deactivated' AND r.id = (m.row_data->>'id')::uuid;
UPDATE public.rw_units u SET is_active = true FROM rw_archive.removed_masters m
 WHERE m.source_table = 'rw_units' AND m.action = 'deactivated' AND u.id = (m.row_data->>'id')::uuid;
UPDATE public.rw_dispositions d SET is_active = true FROM rw_archive.removed_masters m
 WHERE m.source_table = 'rw_dispositions' AND m.action = 'deactivated' AND d.id = (m.row_data->>'id')::uuid;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261118120000';

COMMIT;
