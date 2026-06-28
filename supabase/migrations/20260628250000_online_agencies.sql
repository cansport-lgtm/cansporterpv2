-- Marketing/social-media agency: a monthly fixed retainer + commission as a % of
-- net sales (gross − returns − shipping). Costs flow into the online P&L, and
-- monthly settlements can be generated and shared with the agency.

CREATE TABLE IF NOT EXISTS public.agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact text,
  monthly_fixed numeric NOT NULL DEFAULT 0,
  commission_pct numeric NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.agencies ADD CONSTRAINT agencies_pct_chk CHECK (commission_pct >= 0 AND commission_pct <= 100);
ALTER TABLE public.agencies ADD CONSTRAINT agencies_fixed_chk CHECK (monthly_fixed >= 0);
ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agencies_select" ON public.agencies FOR SELECT TO anon USING (true);
CREATE POLICY "agencies_insert" ON public.agencies FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "agencies_update" ON public.agencies FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "agencies_delete" ON public.agencies FOR DELETE TO anon USING (true);

CREATE TABLE IF NOT EXISTS public.agency_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  period text NOT NULL,
  fixed_amount numeric DEFAULT 0,
  commission_base numeric DEFAULT 0,
  commission_pct numeric DEFAULT 0,
  commission_amount numeric DEFAULT 0,
  total_amount numeric DEFAULT 0,
  status text DEFAULT 'pending',
  paid_at timestamptz, payment_ref text, notes text,
  created_by uuid, created_at timestamptz DEFAULT now(),
  UNIQUE (agency_id, period)
);
ALTER TABLE public.agency_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency_settlements_select" ON public.agency_settlements FOR SELECT TO anon USING (true);
CREATE POLICY "agency_settlements_insert" ON public.agency_settlements FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "agency_settlements_update" ON public.agency_settlements FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "agency_settlements_delete" ON public.agency_settlements FOR DELETE TO anon USING (true);
