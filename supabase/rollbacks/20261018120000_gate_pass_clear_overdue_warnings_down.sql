-- Rollback for 20261018120000_gate_pass_clear_overdue_warnings.sql.
-- Restores the daily overdue job without clearing; cleared warnings stay read.
DROP TRIGGER IF EXISTS gate_pass_clear_overdue_on_status ON public.gate_passes;
DROP FUNCTION IF EXISTS public.gate_pass_clear_overdue_on_status();

CREATE OR REPLACE FUNCTION public.gate_pass_notify_overdue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_n integer := 0;
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
BEGIN
  FOR g IN SELECT * FROM public.gate_passes
            WHERE pass_type IN ('returnable','job_work') AND status IN ('out','partially_returned')
              AND expected_return_date < v_today LOOP
    PERFORM public.gate_pass_notify(g, 'Gate pass overdue',
      g.pass_number || ' · ' || initcap(replace(g.pass_type, '_', ' ')) || ' with ' || g.party_name
        || ' was due back on ' || to_char(g.expected_return_date, 'DD Mon YYYY')
        || ' (' || (v_today - g.expected_return_date) || ' day(s) late)',
      'warning', true, true);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

DROP FUNCTION IF EXISTS public.gate_pass_clear_overdue_warnings(uuid);
