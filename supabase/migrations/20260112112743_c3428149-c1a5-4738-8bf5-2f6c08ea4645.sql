-- Spare Parts Issue/Usage Tracking System

-- 1. Create spare_part_issues table for tracking spare part usage
CREATE TABLE public.spare_part_issues (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_number VARCHAR(50) NOT NULL UNIQUE,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  spare_part_id UUID NOT NULL REFERENCES public.spare_parts(id),
  quantity_issued INTEGER NOT NULL DEFAULT 1,
  issued_to UUID REFERENCES public.app_users(id),
  machine_id UUID REFERENCES public.machines(id),
  work_order_id UUID REFERENCES public.maintenance_work_orders(id),
  purpose TEXT,
  remarks TEXT,
  unit_cost DECIMAL(12,2),
  total_cost DECIMAL(12,2),
  issued_by UUID REFERENCES public.app_users(id),
  status VARCHAR(50) DEFAULT 'issued',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE public.spare_part_issues ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS policy
CREATE POLICY "Allow all for authenticated" ON public.spare_part_issues FOR ALL USING (true) WITH CHECK (true);

-- 4. Create function to update spare part stock on issue
CREATE OR REPLACE FUNCTION public.update_spare_part_stock_on_issue()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE spare_parts SET current_stock = current_stock - NEW.quantity_issued WHERE id = NEW.spare_part_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE spare_parts SET current_stock = current_stock + OLD.quantity_issued WHERE id = OLD.spare_part_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE spare_parts SET current_stock = current_stock + OLD.quantity_issued - NEW.quantity_issued WHERE id = NEW.spare_part_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Create trigger
CREATE TRIGGER trigger_update_spare_part_stock_on_issue
AFTER INSERT OR UPDATE OR DELETE ON public.spare_part_issues
FOR EACH ROW EXECUTE FUNCTION public.update_spare_part_stock_on_issue();

-- 6. Create function to generate issue number
CREATE OR REPLACE FUNCTION public.generate_spare_part_issue_number()
RETURNS TRIGGER AS $$
DECLARE
  new_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(issue_number FROM 5) AS INTEGER)), 0) + 1 
  INTO new_number 
  FROM public.spare_part_issues;
  
  NEW.issue_number := 'SPI-' || LPAD(new_number::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create trigger for auto-generating issue number
CREATE TRIGGER trigger_generate_spare_part_issue_number
BEFORE INSERT ON public.spare_part_issues
FOR EACH ROW WHEN (NEW.issue_number IS NULL OR NEW.issue_number = '')
EXECUTE FUNCTION public.generate_spare_part_issue_number();