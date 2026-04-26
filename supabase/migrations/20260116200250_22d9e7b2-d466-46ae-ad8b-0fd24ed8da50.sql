-- Create labour productivity targets table
CREATE TABLE public.labour_productivity_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.production_departments(id) ON DELETE CASCADE,
  target_date DATE NOT NULL DEFAULT CURRENT_DATE,
  target_quantity INTEGER NOT NULL DEFAULT 0,
  actual_quantity INTEGER NOT NULL DEFAULT 0,
  efficiency_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN target_quantity > 0 THEN (actual_quantity::DECIMAL / target_quantity * 100) ELSE 0 END
  ) STORED,
  shift VARCHAR(20) DEFAULT 'Day',
  uom_id UUID REFERENCES public.units_of_measure(id),
  remarks TEXT,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, target_date, shift)
);

-- Enable RLS
ALTER TABLE public.labour_productivity_targets ENABLE ROW LEVEL SECURITY;

-- RLS policies (permissive for now, can be tightened based on roles)
CREATE POLICY "Allow all operations on labour_productivity_targets"
ON public.labour_productivity_targets
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_labour_productivity_date ON public.labour_productivity_targets(target_date);
CREATE INDEX idx_labour_productivity_employee ON public.labour_productivity_targets(employee_id);
CREATE INDEX idx_labour_productivity_department ON public.labour_productivity_targets(department_id);

-- Trigger for updated_at
CREATE TRIGGER update_labour_productivity_targets_updated_at
BEFORE UPDATE ON public.labour_productivity_targets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();