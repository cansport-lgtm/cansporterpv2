-- Reorder level on items for low-stock alerts.
ALTER TABLE public.online_items ADD COLUMN IF NOT EXISTS reorder_level numeric NOT NULL DEFAULT 0;

-- Stock movements ledger for online items. Current stock for an item is the
-- signed sum of quantity_in - quantity_out across its movements.
CREATE TABLE IF NOT EXISTS public.online_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.online_items(id) ON DELETE CASCADE,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  type text NOT NULL,                 -- opening | purchase | adjustment_in | sale | return_in | adjustment_out | damage
  direction text NOT NULL,            -- in | out
  quantity numeric NOT NULL,          -- always positive; direction carries the sign
  unit_cost numeric,                  -- for purchases / opening (used to refresh item cost)
  reference text,
  note text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.online_stock_movements ADD CONSTRAINT online_stock_qty_chk CHECK (quantity >= 0);
ALTER TABLE public.online_stock_movements ADD CONSTRAINT online_stock_dir_chk CHECK (direction IN ('in','out'));
CREATE INDEX IF NOT EXISTS online_stock_movements_item_idx ON public.online_stock_movements(item_id);
ALTER TABLE public.online_stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "online_stock_select" ON public.online_stock_movements FOR SELECT TO anon USING (true);
CREATE POLICY "online_stock_insert" ON public.online_stock_movements FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "online_stock_update" ON public.online_stock_movements FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "online_stock_delete" ON public.online_stock_movements FOR DELETE TO anon USING (true);
