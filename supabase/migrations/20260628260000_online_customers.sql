-- Persistent customer flags for the online sales unit. Customer stats are
-- derived live from online_orders (keyed by phone); this table holds the
-- manual overlay: blacklist flag, risk note, and the latest known name/city.
CREATE TABLE IF NOT EXISTS public.online_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  name text,
  city text,
  is_blacklisted boolean NOT NULL DEFAULT false,
  risk_note text,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.online_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "online_customers_select" ON public.online_customers FOR SELECT TO anon USING (true);
CREATE POLICY "online_customers_insert" ON public.online_customers FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "online_customers_update" ON public.online_customers FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "online_customers_delete" ON public.online_customers FOR DELETE TO anon USING (true);
