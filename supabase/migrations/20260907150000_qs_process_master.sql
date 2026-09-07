-- Quality Score: process master + process selection on Process Quality scores.
--
-- Inspectors pick WHICH production process they are assessing (e.g. Hand Stitching,
-- Moulding) when submitting a Process Quality score. Processes are maintained in a
-- new qs_processes master; a process can optionally be tied to a department so the
-- entry form only offers relevant processes.

CREATE TABLE IF NOT EXISTS public.qs_processes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  department_id uuid REFERENCES public.production_departments(id),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qs_processes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for qs_processes" ON public.qs_processes;
CREATE POLICY "Allow all for qs_processes" ON public.qs_processes
  FOR ALL TO public USING (true) WITH CHECK (true);

-- Which process each inspector assessed (name snapshotted so master edits never
-- rewrite history, same rule as parameter weights)
ALTER TABLE public.qs_process_scores
  ADD COLUMN IF NOT EXISTS process_id uuid REFERENCES public.qs_processes(id),
  ADD COLUMN IF NOT EXISTS process_name text;

-- Re-create the submit RPC with the process argument. The old signature must be
-- dropped first — CREATE OR REPLACE with a different argument list would create an
-- overload and make PostgREST rpc() calls ambiguous.
DROP FUNCTION IF EXISTS public.qs_submit_process_score(uuid, uuid, jsonb, numeric);

CREATE OR REPLACE FUNCTION public.qs_submit_process_score(
  p_entry_id uuid,
  p_inspector_id uuid,
  p_scores jsonb DEFAULT NULL,
  p_holistic numeric DEFAULT NULL,
  p_process_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_process_name text;
  v_param public.qs_parameters%ROWTYPE;
  v_score numeric;
  v_total_weight numeric := 0;
  v_weighted numeric := 0;
  v_process_score_id uuid;
BEGIN
  IF p_entry_id IS NULL OR p_inspector_id IS NULL THEN
    RAISE EXCEPTION 'entry and inspector are required';
  END IF;

  IF p_process_id IS NOT NULL THEN
    SELECT name INTO v_process_name FROM public.qs_processes WHERE id = p_process_id;
    IF v_process_name IS NULL THEN
      RAISE EXCEPTION 'Unknown process';
    END IF;
  END IF;

  SELECT process_mode INTO v_mode FROM public.qs_settings WHERE id = 1;

  IF v_mode = 'holistic' THEN
    IF p_holistic IS NULL OR p_holistic < 0 OR p_holistic > 10 THEN
      RAISE EXCEPTION 'Holistic score must be between 0 and 10';
    END IF;
    v_weighted := round(p_holistic, 2);
  ELSE
    FOR v_param IN
      SELECT * FROM public.qs_parameters WHERE scope = 'process' AND is_active ORDER BY sort_order
    LOOP
      v_score := (
        SELECT (s->>'score')::numeric FROM jsonb_array_elements(p_scores) s
        WHERE (s->>'parameter_id')::uuid = v_param.id
      );
      IF v_score IS NULL THEN
        RAISE EXCEPTION 'Missing score for parameter %', v_param.name;
      END IF;
      IF v_score < 0 OR v_score > 10 THEN
        RAISE EXCEPTION 'Score for % must be between 0 and 10', v_param.name;
      END IF;
      v_total_weight := v_total_weight + v_param.weight;
      v_weighted := v_weighted + v_score * v_param.weight;
    END LOOP;

    IF v_total_weight <> 100 THEN
      RAISE EXCEPTION 'Process Quality parameter weights total % — fix the Parameters Master so they total 100', v_total_weight;
    END IF;
    v_weighted := round(v_weighted / 100.0, 2);
  END IF;

  INSERT INTO public.qs_process_scores (entry_id, inspector_id, mode, score, process_id, process_name)
  VALUES (p_entry_id, p_inspector_id, v_mode, v_weighted, p_process_id, v_process_name)
  ON CONFLICT (entry_id, inspector_id)
  DO UPDATE SET mode = EXCLUDED.mode, score = EXCLUDED.score,
                process_id = EXCLUDED.process_id, process_name = EXCLUDED.process_name,
                updated_at = now()
  RETURNING id INTO v_process_score_id;

  DELETE FROM public.qs_process_score_params WHERE process_score_id = v_process_score_id;
  IF v_mode = 'parameters' THEN
    INSERT INTO public.qs_process_score_params (process_score_id, parameter_id, parameter_name, weight, score)
    SELECT v_process_score_id, p.id, p.name, p.weight,
           (SELECT (s->>'score')::numeric FROM jsonb_array_elements(p_scores) s
            WHERE (s->>'parameter_id')::uuid = p.id)
    FROM public.qs_parameters p
    WHERE p.scope = 'process' AND p.is_active;
  END IF;

  PERFORM public.qs_refresh_entry_status(p_entry_id);
  RETURN v_weighted;
END;
$$;
