-- WIP Management module: ported from v1 lineage into v2.
-- 3 tables (wip_stages, wip_stage_thresholds, wip_stock_entries) + updated_at
-- triggers + anon-auth RLS. (production_wip_sequence already exists in prod.)

CREATE TABLE IF NOT EXISTS public.wip_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sequence_order integer NOT NULL,
  unit text NOT NULL DEFAULT 'dozens',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wip_stages_name_key UNIQUE (name),
  CONSTRAINT wip_stages_sequence_order_key UNIQUE (sequence_order)
);

CREATE TABLE IF NOT EXISTS public.wip_stage_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL,
  max_threshold numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'dozens',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wip_stage_thresholds_stage_id_key UNIQUE (stage_id),
  CONSTRAINT wip_stage_thresholds_stage_id_fkey
    FOREIGN KEY (stage_id) REFERENCES public.wip_stages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.wip_stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  entry_time time without time zone NOT NULL DEFAULT CURRENT_TIME,
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'dozens',
  remarks text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wip_stock_entries_stage_id_fkey
    FOREIGN KEY (stage_id) REFERENCES public.wip_stages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS wip_stock_entries_stage_date_idx
  ON public.wip_stock_entries (stage_id, entry_date DESC, entry_time DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wip_stages','wip_stage_thresholds','wip_stock_entries'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %s_updated_at ON public.%I;', t, t);
    EXECUTE format('CREATE TRIGGER %s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t, t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Allow all for %s" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END $$;
