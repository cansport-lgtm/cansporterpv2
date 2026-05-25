
-- Hourly Production: Material Issuance module
CREATE TABLE public.hp_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'pcs',
  category text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hp_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hpm_select_all" ON public.hp_materials FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "hpm_insert_all" ON public.hp_materials FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "hpm_update_all" ON public.hp_materials FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "hpm_delete_all" ON public.hp_materials FOR DELETE TO anon, authenticated USING (true);
CREATE TRIGGER hpm_set_updated_at BEFORE UPDATE ON public.hp_materials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.hp_material_issuance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_date date NOT NULL,
  department_id uuid NOT NULL REFERENCES public.production_departments(id) ON DELETE RESTRICT,
  issued_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hp_material_issuance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hpmi_select_all" ON public.hp_material_issuance FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "hpmi_insert_all" ON public.hp_material_issuance FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "hpmi_update_all" ON public.hp_material_issuance FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "hpmi_delete_all" ON public.hp_material_issuance FOR DELETE TO anon, authenticated USING (true);
CREATE TRIGGER hpmi_set_updated_at BEFORE UPDATE ON public.hp_material_issuance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_hpmi_date_dept ON public.hp_material_issuance(issue_date, department_id);

CREATE TABLE public.hp_material_issuance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuance_id uuid NOT NULL REFERENCES public.hp_material_issuance(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.hp_materials(id) ON DELETE RESTRICT,
  issued_qty numeric NOT NULL DEFAULT 0,
  receiver_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  accepted_by uuid,
  accepted_at timestamptz,
  consumed_qty numeric,
  closed_at timestamptz,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hp_material_issuance_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hpmii_select_all" ON public.hp_material_issuance_items FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "hpmii_insert_all" ON public.hp_material_issuance_items FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "hpmii_update_all" ON public.hp_material_issuance_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "hpmii_delete_all" ON public.hp_material_issuance_items FOR DELETE TO anon, authenticated USING (true);
CREATE TRIGGER hpmii_set_updated_at BEFORE UPDATE ON public.hp_material_issuance_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_hpmii_issuance ON public.hp_material_issuance_items(issuance_id);
CREATE INDEX idx_hpmii_receiver_status ON public.hp_material_issuance_items(receiver_user_id, status);
CREATE INDEX idx_hpmii_material ON public.hp_material_issuance_items(material_id);
