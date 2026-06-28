-- Marketing / ad spend (e.g. Meta) so it flows into the online P&L and Expenses.
-- Manual/CSV entry now; the external_id unique index lets a future Meta API
-- sync upsert daily spend rows idempotently.

CREATE TABLE IF NOT EXISTS public.marketing_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spend_date date NOT NULL DEFAULT CURRENT_DATE,
  platform text NOT NULL DEFAULT 'Meta',
  campaign text,
  amount numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',   -- manual | meta_api | csv
  external_id text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.marketing_spend ADD CONSTRAINT marketing_spend_amount_chk CHECK (amount >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_spend_external ON public.marketing_spend(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_spend_date ON public.marketing_spend(spend_date);

ALTER TABLE public.marketing_spend ENABLE ROW LEVEL SECURITY;
CREATE POLICY "marketing_spend_select" ON public.marketing_spend FOR SELECT TO anon USING (true);
CREATE POLICY "marketing_spend_insert" ON public.marketing_spend FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "marketing_spend_update" ON public.marketing_spend FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "marketing_spend_delete" ON public.marketing_spend FOR DELETE TO anon USING (true);
