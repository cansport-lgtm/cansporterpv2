-- Rollback for 20261002120100_labour_gate_pass.sql (and the role in
-- 20261002120000_labour_gate_pass_roles.sql, which cannot be removed: enum
-- values stay; unassign the role from users instead).
--
-- Productivity rows already set to half day by a pass keep that value; the
-- remark "Left on gate pass LGP-…" stays on them.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'labour-gate-pass-tick';
  END IF;
END $$;

DROP TRIGGER IF EXISTS labour_productivity_force_half_day ON public.labour_productivity_targets;
DROP FUNCTION IF EXISTS public.labour_productivity_force_half_day();

DROP FUNCTION IF EXISTS public.labour_gate_pass_settings_save(integer, integer, time, boolean);
DROP FUNCTION IF EXISTS public.labour_gate_pass_tick();
DROP FUNCTION IF EXISTS public.labour_gate_pass_convert_half_day(uuid, text);
DROP FUNCTION IF EXISTS public.labour_gate_pass_log_rescan(uuid);
DROP FUNCTION IF EXISTS public.labour_gate_pass_gate_in(uuid);
DROP FUNCTION IF EXISTS public.labour_gate_pass_gate_out(uuid);
DROP FUNCTION IF EXISTS public.labour_gate_pass_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.labour_gate_pass_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.labour_gate_pass_apply(uuid, text, text, integer, time, date);
DROP FUNCTION IF EXISTS public.labour_gate_pass_mark_half_day(uuid);
DROP FUNCTION IF EXISTS public.labour_gate_pass_notify(public.labour_gate_passes, text, text, text, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.labour_gate_pass_half_day_exists(uuid, date);
DROP FUNCTION IF EXISTS public.labour_gate_pass_fmt(timestamptz);
DROP FUNCTION IF EXISTS public.labour_gate_pass_label(public.labour_gate_passes);
DROP FUNCTION IF EXISTS public.labour_gate_pass_log(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.labour_gate_pass_today();
DROP FUNCTION IF EXISTS public.labour_gate_pass_can(text);

DROP VIEW IF EXISTS public.v_labour_gate_pass_half_days;

DROP TABLE IF EXISTS public.labour_gate_pass_events;
DROP TABLE IF EXISTS public.labour_gate_pass_settings;
DROP TABLE IF EXISTS public.labour_gate_passes;
DROP SEQUENCE IF EXISTS public.labour_gate_pass_number_seq;
