
CREATE TABLE public.ar_sales_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  invoice_number text,
  invoice_date date,
  invoice_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES public.app_users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ar_sales_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access for anon on ar_sales_imports"
ON public.ar_sales_imports FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE public.ar_payment_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  payment_date date,
  payment_amount numeric NOT NULL DEFAULT 0,
  reference_number text,
  payment_mode text DEFAULT 'cash',
  notes text,
  created_by uuid REFERENCES public.app_users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ar_payment_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access for anon on ar_payment_imports"
ON public.ar_payment_imports FOR ALL TO anon USING (true) WITH CHECK (true);
