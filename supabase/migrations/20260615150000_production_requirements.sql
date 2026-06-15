-- Production Requirements (for Production Coordinator + QA Quality Coordinator pages),
-- ported from v1. 2 tables + auto-number trigger + updated_at trigger + anon-auth RLS.

CREATE TABLE IF NOT EXISTS public.production_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_number text,
  window_from date NOT NULL,
  window_to date NOT NULL,
  title text,
  notes text,
  status text NOT NULL DEFAULT 'Draft',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  priority text NOT NULL DEFAULT 'Medium',
  CONSTRAINT production_requirements_requirement_number_key UNIQUE (requirement_number)
);

CREATE TABLE IF NOT EXISTS public.production_requirement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid NOT NULL,
  planning_item_id uuid,
  required_qty numeric NOT NULL DEFAULT 0,
  unit text,
  required_by date,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_requirement_items_requirement_id_fkey
    FOREIGN KEY (requirement_id) REFERENCES public.production_requirements(id) ON DELETE CASCADE
);

-- Auto-number: PR-YY-NNNN (pages insert requirement_number = '' and rely on this)
CREATE OR REPLACE FUNCTION public.generate_production_requirement_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_year TEXT; v_max_num INT;
BEGIN
  IF NEW.requirement_number IS NOT NULL AND NEW.requirement_number <> '' THEN RETURN NEW; END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(NULLIF(SUBSTRING(requirement_number FROM 7), '')::INTEGER), 0) + 1
    INTO v_max_num
    FROM public.production_requirements
    WHERE requirement_number LIKE 'PR-' || v_year || '-%';
  NEW.requirement_number := 'PR-' || v_year || '-' || LPAD(v_max_num::TEXT, 4, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_generate_production_requirement_number ON public.production_requirements;
CREATE TRIGGER trg_generate_production_requirement_number
  BEFORE INSERT ON public.production_requirements
  FOR EACH ROW EXECUTE FUNCTION public.generate_production_requirement_number();

DROP TRIGGER IF EXISTS trg_production_requirements_updated_at ON public.production_requirements;
CREATE TRIGGER trg_production_requirements_updated_at
  BEFORE UPDATE ON public.production_requirements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: anon-auth model (Allow all TO public)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['production_requirements','production_requirement_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Allow all for %s" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END $$;
