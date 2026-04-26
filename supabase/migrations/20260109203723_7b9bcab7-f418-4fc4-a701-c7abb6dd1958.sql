-- Create production_orders table
CREATE TABLE public.production_orders (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    order_number VARCHAR(50) NOT NULL UNIQUE,
    customer_id UUID REFERENCES public.customers(id),
    product_id UUID REFERENCES public.products(id),
    grade_id UUID REFERENCES public.grades(id),
    department_id UUID REFERENCES public.production_departments(id),
    quantity_ordered NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity_produced NUMERIC(12,2) NOT NULL DEFAULT 0,
    uom_id UUID REFERENCES public.units_of_measure(id),
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled', 'on_hold')),
    remarks TEXT,
    created_by UUID REFERENCES public.app_users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated access (using service role for now since we use custom auth)
CREATE POLICY "Allow all access to production_orders" 
ON public.production_orders 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create trigger for updated_at
CREATE TRIGGER update_production_orders_updated_at
BEFORE UPDATE ON public.production_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create sequence for order numbers
CREATE SEQUENCE IF NOT EXISTS production_order_seq START 1;

-- Create function to generate order number
CREATE OR REPLACE FUNCTION public.generate_production_order_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
        NEW.order_number := 'PO-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-' || LPAD(nextval('production_order_seq')::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger to auto-generate order number
CREATE TRIGGER generate_order_number_trigger
BEFORE INSERT ON public.production_orders
FOR EACH ROW
EXECUTE FUNCTION public.generate_production_order_number();

-- Add index for common queries
CREATE INDEX idx_production_orders_status ON public.production_orders(status);
CREATE INDEX idx_production_orders_customer ON public.production_orders(customer_id);
CREATE INDEX idx_production_orders_due_date ON public.production_orders(due_date);