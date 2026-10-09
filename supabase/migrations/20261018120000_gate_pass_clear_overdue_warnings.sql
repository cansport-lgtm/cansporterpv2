-- "Gate pass overdue" warnings stayed unread after the goods came back, and a
-- new one piled up every morning. Now:
--  * when a returnable / job-work pass is returned, closed or cancelled, its
--    overdue warnings are marked read;
--  * the daily job marks yesterday's overdue warning read before sending
--    today's, so each pass shows one current warning;
--  * warnings already left on passes that are no longer out are cleared.

CREATE OR REPLACE FUNCTION public.gate_pass_clear_overdue_warnings(p_pass uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.notifications
     SET is_read = true, read_at = COALESCE(read_at, now())
   WHERE reference_type = 'gate_pass' AND reference_id = p_pass
     AND title = 'Gate pass overdue' AND NOT is_read;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_clear_overdue_on_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND OLD.status IN ('out','partially_returned')
     AND NEW.status NOT IN ('out','partially_returned') THEN
    PERFORM public.gate_pass_clear_overdue_warnings(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gate_pass_clear_overdue_on_status ON public.gate_passes;
CREATE TRIGGER gate_pass_clear_overdue_on_status
  AFTER UPDATE OF status ON public.gate_passes
  FOR EACH ROW EXECUTE FUNCTION public.gate_pass_clear_overdue_on_status();

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
    PERFORM public.gate_pass_clear_overdue_warnings(g.id);
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

-- Clear warnings already left on passes that are back, closed or cancelled.
UPDATE public.notifications n
   SET is_read = true, read_at = COALESCE(n.read_at, now())
  FROM public.gate_passes g
 WHERE n.reference_type = 'gate_pass' AND n.reference_id = g.id
   AND n.title = 'Gate pass overdue' AND NOT n.is_read
   AND g.status NOT IN ('out','partially_returned');

-- Passes still out keep only their latest overdue warning unread.
UPDATE public.notifications n
   SET is_read = true, read_at = COALESCE(n.read_at, now())
 WHERE n.reference_type = 'gate_pass' AND n.title = 'Gate pass overdue' AND NOT n.is_read
   AND EXISTS (SELECT 1 FROM public.notifications m
                WHERE m.reference_type = 'gate_pass' AND m.reference_id = n.reference_id
                  AND m.recipient_id = n.recipient_id AND m.title = 'Gate pass overdue'
                  AND m.created_at > n.created_at);
