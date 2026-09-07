-- Quality Score module — structured product & process quality scoring.
--
-- Two sub-modules, each scored 0–10 by multiple inspectors and averaged:
--   • Ball Quality    — weighted parameters (default: Finishing 50 / Size 20 / Bounce 10 / Hardness 20),
--                       3 inspectors. The weighted score is computed SERVER-SIDE in qs_submit_ball_score.
--   • Process Quality — labor/workmanship parameters (default: 5 params at 20 each) or a single
--                       holistic score, 2 inspectors. Mode is a module setting.
-- Overall Quality Score = configurable weighted average of the two sub-module averages (default 50/50).
--
-- Raw per-inspector scores are stored individually (audit trail); parameter name + weight are
-- snapshotted onto each score row so editing the parameter master never rewrites history.

-- Module access tiers (same three-tier pattern as the other modules)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'quality_score_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'quality_score_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'quality_score_viewer';

-- Parameter master (both sub-modules share one table, split by scope)
CREATE TABLE IF NOT EXISTS public.qs_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('ball', 'process')),
  name text NOT NULL,
  description text,
  weight numeric(5,2) NOT NULL DEFAULT 0 CHECK (weight >= 0 AND weight <= 100),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, name)
);

-- Module settings (single row)
CREATE TABLE IF NOT EXISTS public.qs_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ball_weight numeric(5,2) NOT NULL DEFAULT 50 CHECK (ball_weight >= 0 AND ball_weight <= 100),
  process_weight numeric(5,2) NOT NULL DEFAULT 50 CHECK (process_weight >= 0 AND process_weight <= 100),
  process_mode text NOT NULL DEFAULT 'parameters' CHECK (process_mode IN ('holistic', 'parameters')),
  ball_inspector_count integer NOT NULL DEFAULT 3 CHECK (ball_inspector_count >= 1),
  process_inspector_count integer NOT NULL DEFAULT 2 CHECK (process_inspector_count >= 1),
  disagreement_threshold numeric(4,2) NOT NULL DEFAULT 1.5 CHECK (disagreement_threshold >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ball_weight + process_weight = 100)
);

-- One score entry = one scoring context (date + department + shift, optionally product/grade)
CREATE TABLE IF NOT EXISTS public.qs_score_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  department_id uuid NOT NULL REFERENCES public.production_departments(id),
  shift text NOT NULL DEFAULT 'morning' CHECK (shift IN ('morning', 'afternoon', 'night')),
  product_id uuid REFERENCES public.products(id),
  grade_id uuid REFERENCES public.grades(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'complete')),
  remarks text,
  created_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qs_score_entries_date_idx ON public.qs_score_entries (entry_date, department_id);

-- One row per inspector per entry; weighted_score computed server-side
CREATE TABLE IF NOT EXISTS public.qs_ball_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.qs_score_entries(id) ON DELETE CASCADE,
  inspector_id uuid NOT NULL REFERENCES public.app_users(id),
  weighted_score numeric(4,2) NOT NULL CHECK (weighted_score >= 0 AND weighted_score <= 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, inspector_id)
);

CREATE TABLE IF NOT EXISTS public.qs_ball_score_params (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ball_score_id uuid NOT NULL REFERENCES public.qs_ball_scores(id) ON DELETE CASCADE,
  parameter_id uuid NOT NULL REFERENCES public.qs_parameters(id),
  parameter_name text NOT NULL,
  weight numeric(5,2) NOT NULL,
  score numeric(4,2) NOT NULL CHECK (score >= 0 AND score <= 10),
  UNIQUE (ball_score_id, parameter_id)
);

CREATE TABLE IF NOT EXISTS public.qs_process_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.qs_score_entries(id) ON DELETE CASCADE,
  inspector_id uuid NOT NULL REFERENCES public.app_users(id),
  mode text NOT NULL CHECK (mode IN ('holistic', 'parameters')),
  score numeric(4,2) NOT NULL CHECK (score >= 0 AND score <= 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, inspector_id)
);

CREATE TABLE IF NOT EXISTS public.qs_process_score_params (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_score_id uuid NOT NULL REFERENCES public.qs_process_scores(id) ON DELETE CASCADE,
  parameter_id uuid NOT NULL REFERENCES public.qs_parameters(id),
  parameter_name text NOT NULL,
  weight numeric(5,2) NOT NULL,
  score numeric(4,2) NOT NULL CHECK (score >= 0 AND score <= 10),
  UNIQUE (process_score_id, parameter_id)
);

-- Open RLS, same as the rest of the app (enforcement is client-side via roles/permissions)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'qs_parameters', 'qs_settings', 'qs_score_entries',
    'qs_ball_scores', 'qs_ball_score_params',
    'qs_process_scores', 'qs_process_score_params'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Allow all for %s" ON public.%I '
                   'FOR ALL TO public USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END $$;

-- Seed defaults (idempotent; only when the table is empty so re-runs never duplicate)
INSERT INTO public.qs_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.qs_parameters (scope, name, description, weight, sort_order)
SELECT * FROM (VALUES
  ('ball', 'Finishing', 'Stitching, seam alignment, coating consistency, visible defects', 50::numeric, 1),
  ('ball', 'Size', 'Diameter / circumference conformance to size standard', 20::numeric, 2),
  ('ball', 'Bounce', 'Rebound performance against the expected bounce standard', 10::numeric, 3),
  ('ball', 'Hardness', 'Firmness / compression against the acceptable hardness range', 20::numeric, 4),
  ('process', 'Work Quality', 'Workmanship and accuracy against the production specification', 20::numeric, 1),
  ('process', 'Attention to Detail', 'Precision in process steps; small errors caught and corrected', 20::numeric, 2),
  ('process', 'Process Adherence', 'Compliance with SOP and required sequence of operations', 20::numeric, 3),
  ('process', 'Efficiency / Time Management', 'Work completed within time targets without compromising quality', 20::numeric, 4),
  ('process', 'Workplace Discipline & Safety', 'Workstation cleanliness, tool handling and safety practices', 20::numeric, 5)
) AS seed(scope, name, description, weight, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.qs_parameters);

-- Recompute an entry's status from how many inspectors have submitted
CREATE OR REPLACE FUNCTION public.qs_refresh_entry_status(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_settings public.qs_settings%ROWTYPE;
  v_ball integer;
  v_process integer;
BEGIN
  SELECT * INTO v_settings FROM public.qs_settings WHERE id = 1;
  SELECT count(*) INTO v_ball FROM public.qs_ball_scores WHERE entry_id = p_entry_id;
  SELECT count(*) INTO v_process FROM public.qs_process_scores WHERE entry_id = p_entry_id;
  UPDATE public.qs_score_entries
  SET status = CASE
        WHEN v_ball >= v_settings.ball_inspector_count
         AND v_process >= v_settings.process_inspector_count THEN 'complete'
        ELSE 'open'
      END,
      updated_at = now()
  WHERE id = p_entry_id;
END;
$$;

-- Submit (or resubmit) one inspector's Ball Quality parameter scores.
-- p_scores: [{"parameter_id": "...", "score": 8.5}, ...] — must cover every ACTIVE ball
-- parameter. The weighted score is computed here from the master weights and the
-- name/weight are snapshotted onto the score rows.
CREATE OR REPLACE FUNCTION public.qs_submit_ball_score(
  p_entry_id uuid,
  p_inspector_id uuid,
  p_scores jsonb
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_param public.qs_parameters%ROWTYPE;
  v_score numeric;
  v_total_weight numeric := 0;
  v_weighted numeric := 0;
  v_ball_score_id uuid;
BEGIN
  IF p_entry_id IS NULL OR p_inspector_id IS NULL THEN
    RAISE EXCEPTION 'entry and inspector are required';
  END IF;

  FOR v_param IN
    SELECT * FROM public.qs_parameters WHERE scope = 'ball' AND is_active ORDER BY sort_order
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
    RAISE EXCEPTION 'Ball Quality parameter weights total % — fix the Parameters Master so they total 100', v_total_weight;
  END IF;
  v_weighted := round(v_weighted / 100.0, 2);

  INSERT INTO public.qs_ball_scores (entry_id, inspector_id, weighted_score)
  VALUES (p_entry_id, p_inspector_id, v_weighted)
  ON CONFLICT (entry_id, inspector_id)
  DO UPDATE SET weighted_score = EXCLUDED.weighted_score, updated_at = now()
  RETURNING id INTO v_ball_score_id;

  DELETE FROM public.qs_ball_score_params WHERE ball_score_id = v_ball_score_id;
  INSERT INTO public.qs_ball_score_params (ball_score_id, parameter_id, parameter_name, weight, score)
  SELECT v_ball_score_id, p.id, p.name, p.weight,
         (SELECT (s->>'score')::numeric FROM jsonb_array_elements(p_scores) s
          WHERE (s->>'parameter_id')::uuid = p.id)
  FROM public.qs_parameters p
  WHERE p.scope = 'ball' AND p.is_active;

  PERFORM public.qs_refresh_entry_status(p_entry_id);
  RETURN v_weighted;
END;
$$;

-- Submit (or resubmit) one inspector's Process Quality score.
-- In 'parameters' mode p_scores works like the ball RPC (weighted server-side);
-- in 'holistic' mode p_holistic carries the single 0–10 score and p_scores is ignored.
CREATE OR REPLACE FUNCTION public.qs_submit_process_score(
  p_entry_id uuid,
  p_inspector_id uuid,
  p_scores jsonb DEFAULT NULL,
  p_holistic numeric DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_param public.qs_parameters%ROWTYPE;
  v_score numeric;
  v_total_weight numeric := 0;
  v_weighted numeric := 0;
  v_process_score_id uuid;
BEGIN
  IF p_entry_id IS NULL OR p_inspector_id IS NULL THEN
    RAISE EXCEPTION 'entry and inspector are required';
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

  INSERT INTO public.qs_process_scores (entry_id, inspector_id, mode, score)
  VALUES (p_entry_id, p_inspector_id, v_mode, v_weighted)
  ON CONFLICT (entry_id, inspector_id)
  DO UPDATE SET mode = EXCLUDED.mode, score = EXCLUDED.score, updated_at = now()
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
