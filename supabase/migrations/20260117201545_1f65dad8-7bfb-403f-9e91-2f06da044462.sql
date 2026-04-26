-- Create enum for sales segments
CREATE TYPE public.sales_segment AS ENUM ('private_label', 'domestic', 'export');

-- Add sales_segment to customers table
ALTER TABLE public.customers 
ADD COLUMN sales_segment public.sales_segment NOT NULL DEFAULT 'private_label';

-- Add sales_segment to sales_orders table
ALTER TABLE public.sales_orders 
ADD COLUMN sales_segment public.sales_segment NOT NULL DEFAULT 'private_label';

-- Add sales_segment to sales_dispatches table
ALTER TABLE public.sales_dispatches 
ADD COLUMN sales_segment public.sales_segment NOT NULL DEFAULT 'private_label';

-- Add index for faster filtering
CREATE INDEX idx_customers_segment ON public.customers(sales_segment);
CREATE INDEX idx_sales_orders_segment ON public.sales_orders(sales_segment);
CREATE INDEX idx_sales_dispatches_segment ON public.sales_dispatches(sales_segment);

-- Comment for documentation
COMMENT ON COLUMN public.customers.sales_segment IS 'Indicates which sales segment the customer belongs to: private_label, domestic, or export';
COMMENT ON COLUMN public.sales_orders.sales_segment IS 'Indicates which sales segment the order belongs to';
COMMENT ON COLUMN public.sales_dispatches.sales_segment IS 'Indicates which sales segment the dispatch belongs to';