
CREATE TABLE public.sales_customer_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_customer_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all sales_customer_categories" ON public.sales_customer_categories FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth all sales_customer_categories" ON public.sales_customer_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_sales_customer_categories_updated BEFORE UPDATE ON public.sales_customer_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
