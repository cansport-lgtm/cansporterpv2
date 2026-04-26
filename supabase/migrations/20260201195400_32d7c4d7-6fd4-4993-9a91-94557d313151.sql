-- Create daily stock closing table for planning items
CREATE TABLE public.daily_stock_closing (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  closing_date DATE NOT NULL DEFAULT CURRENT_DATE,
  department_id UUID REFERENCES public.production_departments(id),
  planning_item_id UUID NOT NULL REFERENCES public.planning_items(id) ON DELETE CASCADE,
  opening_quantity NUMERIC NOT NULL DEFAULT 0,
  closing_quantity NUMERIC NOT NULL DEFAULT 0,
  remarks TEXT,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(closing_date, planning_item_id)
);

-- Enable RLS
ALTER TABLE public.daily_stock_closing ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
CREATE POLICY "Full access for daily_stock_closing" 
ON public.daily_stock_closing 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_daily_stock_closing_date ON public.daily_stock_closing(closing_date);
CREATE INDEX idx_daily_stock_closing_department ON public.daily_stock_closing(department_id);
CREATE INDEX idx_daily_stock_closing_item ON public.daily_stock_closing(planning_item_id);