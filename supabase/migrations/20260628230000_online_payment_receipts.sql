-- Payment receipts: acknowledge each PostEx settlement batch (CPR) once its
-- funds are confirmed in the bank. Receipts themselves are derived by grouping
-- settled online_orders by payment_ref; this table stores the acknowledgement.

CREATE TABLE IF NOT EXISTS public.payment_receipts (
  payment_ref text PRIMARY KEY,           -- PostEx CPR reference
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  received_amount numeric,                  -- actual amount credited to bank
  bank_ref text,                            -- bank / transaction reference
  notes text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_receipts_select" ON public.payment_receipts FOR SELECT TO anon USING (true);
CREATE POLICY "payment_receipts_insert" ON public.payment_receipts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "payment_receipts_update" ON public.payment_receipts FOR UPDATE TO anon USING (true) WITH CHECK (true);
