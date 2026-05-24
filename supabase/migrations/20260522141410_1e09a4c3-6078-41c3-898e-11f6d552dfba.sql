
CREATE TABLE public.production_wip_sequence (
  department_id uuid PRIMARY KEY REFERENCES public.production_departments(id) ON DELETE CASCADE,
  wip_order integer NOT NULL DEFAULT 0,
  is_included boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.production_wip_sequence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wip_seq_all_anon" ON public.production_wip_sequence
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "wip_seq_all_auth" ON public.production_wip_sequence
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_wip_seq_updated_at
  BEFORE UPDATE ON public.production_wip_sequence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_wip_seq_order ON public.production_wip_sequence(wip_order);
