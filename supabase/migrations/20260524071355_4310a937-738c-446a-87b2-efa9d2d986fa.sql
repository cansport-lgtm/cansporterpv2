
CREATE TABLE public.job_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_number varchar(50) NOT NULL UNIQUE,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  required_by_date date,
  department_id uuid NOT NULL REFERENCES public.production_departments(id),
  sub_department_id uuid REFERENCES public.production_sub_departments(id),
  status varchar(20) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Issued','Closed')),
  priority varchar(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  remarks text,
  issued_at timestamptz,
  issued_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_orders_department ON public.job_orders(department_id);
CREATE INDEX idx_job_orders_status ON public.job_orders(status);
CREATE INDEX idx_job_orders_date ON public.job_orders(order_date);

CREATE TABLE public.job_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id uuid NOT NULL REFERENCES public.job_orders(id) ON DELETE CASCADE,
  planning_item_id uuid NOT NULL REFERENCES public.planning_items(id),
  quantity numeric NOT NULL DEFAULT 0,
  unit varchar(20),
  remarks text,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_order_items_job ON public.job_order_items(job_order_id);
CREATE INDEX idx_job_order_items_planning ON public.job_order_items(planning_item_id);

ALTER TABLE public.job_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to job_orders" ON public.job_orders TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to job_order_items" ON public.job_order_items TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.generate_job_order_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_year TEXT;
  v_max_num INTEGER;
BEGIN
  IF NEW.job_order_number IS NOT NULL AND NEW.job_order_number <> '' THEN
    RETURN NEW;
  END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(
    CASE WHEN job_order_number LIKE 'JO-' || v_year || '-%'
         THEN NULLIF(SUBSTRING(job_order_number FROM 7), '')::INTEGER
         ELSE 0 END
  ), 0) + 1 INTO v_max_num
  FROM public.job_orders
  WHERE job_order_number LIKE 'JO-' || v_year || '-%';
  NEW.job_order_number := 'JO-' || v_year || '-' || LPAD(v_max_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_orders_generate_number
BEFORE INSERT ON public.job_orders
FOR EACH ROW EXECUTE FUNCTION public.generate_job_order_number();

CREATE TRIGGER job_orders_updated_at
BEFORE UPDATE ON public.job_orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
