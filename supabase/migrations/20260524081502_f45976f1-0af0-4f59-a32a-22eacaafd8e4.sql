CREATE TABLE IF NOT EXISTS public.job_order_eligible_departments (
  department_id uuid PRIMARY KEY REFERENCES public.production_departments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_order_eligible_departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "joed_select_all" ON public.job_order_eligible_departments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "joed_insert_all" ON public.job_order_eligible_departments FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "joed_update_all" ON public.job_order_eligible_departments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "joed_delete_all" ON public.job_order_eligible_departments FOR DELETE TO anon, authenticated USING (true);