-- Create junction table for dispatch-to-orders relationship (for domestic multi-order dispatches)
CREATE TABLE public.sales_dispatch_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dispatch_id UUID NOT NULL REFERENCES public.sales_dispatches(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(dispatch_id, order_id)
);

-- Enable RLS
ALTER TABLE public.sales_dispatch_orders ENABLE ROW LEVEL SECURITY;

-- Create permissive policy
CREATE POLICY "Allow all for sales_dispatch_orders"
  ON public.sales_dispatch_orders
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Make order_id nullable in sales_dispatches (for multi-order dispatches, we'll use the junction table)
ALTER TABLE public.sales_dispatches ALTER COLUMN order_id DROP NOT NULL;