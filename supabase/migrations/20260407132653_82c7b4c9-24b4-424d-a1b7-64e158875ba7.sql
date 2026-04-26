
-- Create online_items table
CREATE TABLE public.online_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.online_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "online_items_select" ON public.online_items FOR SELECT TO anon USING (true);
CREATE POLICY "online_items_insert" ON public.online_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "online_items_update" ON public.online_items FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "online_items_delete" ON public.online_items FOR DELETE TO anon USING (true);

-- Add new columns to online_orders
ALTER TABLE public.online_orders
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.online_items(id),
  ADD COLUMN IF NOT EXISTS item_name text,
  ADD COLUMN IF NOT EXISTS shipping_charges numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wh_income_tax numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wh_sales_tax numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_return_date timestamptz,
  ADD COLUMN IF NOT EXISTS courier_weight numeric;
