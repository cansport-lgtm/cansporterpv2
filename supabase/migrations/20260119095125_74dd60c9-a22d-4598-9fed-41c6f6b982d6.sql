-- Create customer_visits table for salesman visit reports
CREATE TABLE public.customer_visits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visit_number VARCHAR(20) NOT NULL UNIQUE,
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  salesman_id UUID REFERENCES public.app_users(id),
  visit_type VARCHAR(50) NOT NULL DEFAULT 'regular',
  purpose TEXT,
  outcome TEXT,
  follow_up_required BOOLEAN DEFAULT false,
  follow_up_date DATE,
  next_action TEXT,
  order_taken BOOLEAN DEFAULT false,
  order_value DECIMAL(15, 2),
  feedback TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  check_in_time TIMESTAMP WITH TIME ZONE,
  check_out_time TIMESTAMP WITH TIME ZONE,
  duration_minutes INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.customer_visits ENABLE ROW LEVEL SECURITY;

-- Create policies for customer_visits
CREATE POLICY "Allow full access to customer_visits"
ON public.customer_visits
FOR ALL
USING (true)
WITH CHECK (true);

-- Create function to generate visit number
CREATE OR REPLACE FUNCTION public.generate_visit_number()
RETURNS TRIGGER AS $$
DECLARE
  new_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(visit_number FROM 5) AS INTEGER)), 0) + 1
  INTO new_number
  FROM public.customer_visits;
  
  NEW.visit_number := 'VIS-' || LPAD(new_number::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-generating visit number
CREATE TRIGGER trigger_generate_visit_number
  BEFORE INSERT ON public.customer_visits
  FOR EACH ROW
  WHEN (NEW.visit_number IS NULL OR NEW.visit_number = '')
  EXECUTE FUNCTION public.generate_visit_number();

-- Create trigger for updating timestamps
CREATE TRIGGER update_customer_visits_updated_at
  BEFORE UPDATE ON public.customer_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for better query performance
CREATE INDEX idx_customer_visits_visit_date ON public.customer_visits(visit_date);
CREATE INDEX idx_customer_visits_customer_id ON public.customer_visits(customer_id);
CREATE INDEX idx_customer_visits_salesman_id ON public.customer_visits(salesman_id);