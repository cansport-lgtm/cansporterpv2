CREATE TABLE public.crm_product_roadmap_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.crm_products(id) ON DELETE CASCADE,
  launch_plan_id uuid REFERENCES public.crm_launch_plans(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  owner_name text,
  priority text NOT NULL DEFAULT 'Medium',
  status text NOT NULL DEFAULT 'Planned',
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date NOT NULL DEFAULT CURRENT_DATE,
  progress_pct smallint NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_roadmap_product ON public.crm_product_roadmap_items(product_id);
CREATE INDEX idx_crm_roadmap_start ON public.crm_product_roadmap_items(start_date);

ALTER TABLE public.crm_product_roadmap_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon all crm_product_roadmap_items"
ON public.crm_product_roadmap_items
FOR ALL
TO anon
USING (true)
WITH CHECK (true);

CREATE TRIGGER trg_crm_roadmap_updated_at
BEFORE UPDATE ON public.crm_product_roadmap_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();