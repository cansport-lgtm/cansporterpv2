-- Rejections & Wastage module: ported from v1 lineage into v2.
-- 7 tables (rw_*) + updated_at triggers + anon-auth RLS.
-- Referenced existing tables (production_departments, hp_materials,
-- hourly_production_processes, app_users) already exist in prod.

-- Masters first (no inter-rw deps) ----------------------------------------

CREATE TABLE IF NOT EXISTS public.rw_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  name_urdu text,
  CONSTRAINT rw_dispositions_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.rw_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  category text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rw_reasons_type_check CHECK (type = ANY (ARRAY['rejection'::text, 'wastage'::text, 'leakage'::text]))
);

CREATE TABLE IF NOT EXISTS public.rw_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rw_units_symbol_key UNIQUE (symbol)
);

CREATE TABLE IF NOT EXISTS public.rw_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit text NOT NULL DEFAULT 'pcs',
  unit_cost numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  hp_material_id uuid NOT NULL,
  CONSTRAINT rw_materials_hp_material_id_key UNIQUE (hp_material_id),
  CONSTRAINT rw_materials_hp_material_id_fkey
    FOREIGN KEY (hp_material_id) REFERENCES public.hp_materials(id) ON DELETE RESTRICT
);

-- Transaction tables ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rw_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  department_id uuid,
  sub_department_id uuid,
  process_id uuid,
  product_id uuid,
  shift text,
  rejected_qty numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'pcs',
  disposition text NOT NULL DEFAULT 'scrap',
  rework_qty numeric NOT NULL DEFAULT 0,
  rework_status text DEFAULT 'pending',
  rework_completed_at timestamptz,
  reason_id uuid,
  remarks text,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  entered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  material_id uuid,
  disposition_id uuid,
  CONSTRAINT rw_rejections_disposition_check CHECK (disposition = ANY (ARRAY['scrap'::text, 'rework'::text])),
  CONSTRAINT rw_rejections_rework_status_check CHECK (rework_status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text])),
  CONSTRAINT rw_rejections_disposition_id_fkey FOREIGN KEY (disposition_id) REFERENCES public.rw_dispositions(id)
);

CREATE TABLE IF NOT EXISTS public.rw_wastages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  department_id uuid,
  material_id uuid,
  shift text,
  wasted_qty numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'kg',
  reason_id uuid,
  remarks text,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  entered_by uuid,
  entered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disposition_id uuid,
  CONSTRAINT rw_wastages_disposition_id_fkey FOREIGN KEY (disposition_id) REFERENCES public.rw_dispositions(id)
);

CREATE TABLE IF NOT EXISTS public.rw_leakages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  department_id uuid,
  process_id uuid,
  material_id uuid,
  shift text,
  leaked_qty numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'pcs',
  reason_id uuid,
  remarks text,
  unit_cost numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  entered_by uuid,
  entered_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  disposition_id uuid,
  CONSTRAINT rw_leakages_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.production_departments(id) ON DELETE SET NULL,
  CONSTRAINT rw_leakages_disposition_id_fkey FOREIGN KEY (disposition_id) REFERENCES public.rw_dispositions(id),
  CONSTRAINT rw_leakages_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES public.app_users(id) ON DELETE SET NULL,
  CONSTRAINT rw_leakages_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.hp_materials(id) ON DELETE SET NULL,
  CONSTRAINT rw_leakages_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.hourly_production_processes(id) ON DELETE SET NULL,
  CONSTRAINT rw_leakages_reason_id_fkey FOREIGN KEY (reason_id) REFERENCES public.rw_reasons(id) ON DELETE SET NULL
);

-- Indexes (match v1) ------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rw_rejections_date ON public.rw_rejections (entry_date);
CREATE INDEX IF NOT EXISTS idx_rw_rejections_dept ON public.rw_rejections (department_id);
CREATE INDEX IF NOT EXISTS idx_rw_wastages_date  ON public.rw_wastages (entry_date);
CREATE INDEX IF NOT EXISTS idx_rw_wastages_dept  ON public.rw_wastages (department_id);

-- updated_at triggers -----------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rw_dispositions','rw_reasons','rw_units','rw_materials',
    'rw_rejections','rw_wastages','rw_leakages'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON public.%I;', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t, t);
  END LOOP;
END $$;

-- RLS: anon-auth model (Allow all TO public) ------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rw_dispositions','rw_reasons','rw_units','rw_materials',
    'rw_rejections','rw_wastages','rw_leakages'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Allow all for %s" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END $$;
