
-- Add category column to asset_reconciliations
ALTER TABLE public.asset_reconciliations 
ADD COLUMN IF NOT EXISTS asset_category text DEFAULT NULL;

-- Create reconciliation schedule table
CREATE TABLE public.reconciliation_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_category text NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly',
  last_reconciliation_date date DEFAULT NULL,
  next_due_date date NOT NULL,
  is_active boolean DEFAULT true,
  remarks text DEFAULT NULL,
  created_by uuid REFERENCES public.app_users(id) DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.reconciliation_schedules ENABLE ROW LEVEL SECURITY;

-- Permissive RLS policies
CREATE POLICY "Allow all select on reconciliation_schedules" ON public.reconciliation_schedules FOR SELECT USING (true);
CREATE POLICY "Allow all insert on reconciliation_schedules" ON public.reconciliation_schedules FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on reconciliation_schedules" ON public.reconciliation_schedules FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on reconciliation_schedules" ON public.reconciliation_schedules FOR DELETE USING (true);
