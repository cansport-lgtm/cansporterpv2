
-- Asset Reconciliation header table
CREATE TABLE public.asset_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_number TEXT NOT NULL UNIQUE,
  reconciliation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'approved')),
  conducted_by UUID REFERENCES public.app_users(id),
  approved_by UUID REFERENCES public.app_users(id),
  approved_at TIMESTAMPTZ,
  total_assets INTEGER DEFAULT 0,
  verified_count INTEGER DEFAULT 0,
  discrepancy_count INTEGER DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Asset Reconciliation line items
CREATE TABLE public.asset_reconciliation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id UUID NOT NULL REFERENCES public.asset_reconciliations(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.fixed_assets(id),
  book_value NUMERIC DEFAULT 0,
  physical_status TEXT NOT NULL DEFAULT 'not_verified' CHECK (physical_status IN ('not_verified', 'found', 'missing', 'damaged', 'location_mismatch')),
  physical_location TEXT,
  physical_condition TEXT,
  remarks TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.asset_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_reconciliation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON public.asset_reconciliations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.asset_reconciliation_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE SEQUENCE IF NOT EXISTS asset_reconciliation_seq START 1;
