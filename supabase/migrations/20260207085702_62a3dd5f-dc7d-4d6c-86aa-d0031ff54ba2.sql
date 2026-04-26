
-- 5S Audit Checkpoints Master (predefined checklist items per S category)
CREATE TABLE public.five_s_checkpoints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('Sort', 'Set in Order', 'Shine', 'Standardize', 'Sustain')),
  checkpoint_text TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5S Audits (main audit header)
CREATE TABLE public.five_s_audits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_number TEXT NOT NULL UNIQUE,
  department_id UUID REFERENCES public.production_departments(id),
  auditor_id UUID REFERENCES public.app_users(id),
  audit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed')),
  overall_score NUMERIC(5,2) DEFAULT 0,
  total_checkpoints INT DEFAULT 0,
  compliant_count INT DEFAULT 0,
  partial_count INT DEFAULT 0,
  non_compliant_count INT DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5S Audit Responses (individual checkpoint responses)
CREATE TABLE public.five_s_audit_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES public.five_s_audits(id) ON DELETE CASCADE,
  checkpoint_id UUID NOT NULL REFERENCES public.five_s_checkpoints(id),
  response TEXT NOT NULL DEFAULT 'not_checked' CHECK (response IN ('yes', 'no', 'partial', 'not_checked')),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5S Action Items (CAPA from audit findings)
CREATE TABLE public.five_s_action_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES public.five_s_audits(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.production_departments(id),
  description TEXT NOT NULL,
  assigned_to UUID REFERENCES public.app_users(id),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'overdue')),
  due_date DATE,
  completed_date DATE,
  corrective_action TEXT,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.five_s_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.five_s_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.five_s_audit_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.five_s_action_items ENABLE ROW LEVEL SECURITY;

-- RLS policies (open access since auth is custom app-level, not Supabase auth)
CREATE POLICY "Allow all access to five_s_checkpoints" ON public.five_s_checkpoints FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to five_s_audits" ON public.five_s_audits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to five_s_audit_responses" ON public.five_s_audit_responses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to five_s_action_items" ON public.five_s_action_items FOR ALL USING (true) WITH CHECK (true);

-- Insert default checkpoints for each S category
INSERT INTO public.five_s_checkpoints (category, checkpoint_text, sort_order) VALUES
-- Sort
('Sort', 'Unnecessary items removed from work area', 1),
('Sort', 'Red-tagged items properly identified', 2),
('Sort', 'No excess raw materials on floor', 3),
('Sort', 'Only required tools present at workstation', 4),
('Sort', 'Obsolete/broken equipment removed', 5),
-- Set in Order
('Set in Order', 'Tools and materials have designated locations', 6),
('Set in Order', 'Storage areas clearly labeled', 7),
('Set in Order', 'Frequently used items easily accessible', 8),
('Set in Order', 'Shadow boards or outlines for tools in place', 9),
('Set in Order', 'Pathways and aisles clearly marked', 10),
-- Shine
('Shine', 'Work area is clean and free of debris', 11),
('Shine', 'Machines and equipment are clean', 12),
('Shine', 'Floors are clean and dry', 13),
('Shine', 'Cleaning schedule is displayed and followed', 14),
('Shine', 'Waste bins are available and not overflowing', 15),
-- Standardize
('Standardize', 'Standard operating procedures displayed', 16),
('Standardize', 'Visual controls and signs are in place', 17),
('Standardize', 'Color coding system is followed', 18),
('Standardize', 'Consistent layout across similar workstations', 19),
('Standardize', '5S standards are documented and visible', 20),
-- Sustain
('Sustain', 'Regular 5S audits are conducted', 21),
('Sustain', 'Training records for 5S are maintained', 22),
('Sustain', 'Improvement suggestions are encouraged', 23),
('Sustain', 'Previous audit action items are closed', 24),
('Sustain', 'Management commitment to 5S is visible', 25);

-- Trigger for updated_at
CREATE TRIGGER update_five_s_checkpoints_updated_at BEFORE UPDATE ON public.five_s_checkpoints FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_five_s_audits_updated_at BEFORE UPDATE ON public.five_s_audits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_five_s_action_items_updated_at BEFORE UPDATE ON public.five_s_action_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
