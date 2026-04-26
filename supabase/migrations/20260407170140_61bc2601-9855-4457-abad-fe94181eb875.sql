
CREATE TABLE public.online_order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.online_orders(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.online_items(id),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.online_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access to online_order_items" ON public.online_order_items
  FOR ALL TO anon USING (true) WITH CHECK (true);
