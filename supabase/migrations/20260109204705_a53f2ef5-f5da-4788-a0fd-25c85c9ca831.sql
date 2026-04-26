-- Create packing_options enum
CREATE TYPE packing_option AS ENUM ('12_dz_ctns', '20_dz_bag', '60_dz_bag', '20_dz_ctn', '6_dz_ctn');

-- Create production_order_items table for multi-item support
CREATE TABLE public.production_order_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id),
    grade_id UUID REFERENCES public.grades(id),
    quantity_dozens NUMERIC(12, 2) NOT NULL DEFAULT 0,
    packing_type packing_option NOT NULL,
    quantity_produced NUMERIC(12, 2) NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.production_order_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for order items
CREATE POLICY "Allow read for all" ON public.production_order_items FOR SELECT USING (true);
CREATE POLICY "Allow insert for all" ON public.production_order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update for all" ON public.production_order_items FOR UPDATE USING (true);
CREATE POLICY "Allow delete for all" ON public.production_order_items FOR DELETE USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_production_order_items_updated_at
    BEFORE UPDATE ON public.production_order_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes
CREATE INDEX idx_order_items_order_id ON public.production_order_items(order_id);
CREATE INDEX idx_order_items_product_id ON public.production_order_items(product_id);

-- Remove product-level columns from production_orders since items are now in separate table
ALTER TABLE public.production_orders DROP COLUMN IF EXISTS product_id;
ALTER TABLE public.production_orders DROP COLUMN IF EXISTS grade_id;
ALTER TABLE public.production_orders DROP COLUMN IF EXISTS department_id;
ALTER TABLE public.production_orders DROP COLUMN IF EXISTS quantity_ordered;
ALTER TABLE public.production_orders DROP COLUMN IF EXISTS quantity_produced;
ALTER TABLE public.production_orders DROP COLUMN IF EXISTS uom_id;