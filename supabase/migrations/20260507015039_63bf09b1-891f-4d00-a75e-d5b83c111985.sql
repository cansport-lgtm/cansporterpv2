
-- CRM Product & Brand Management tables

CREATE TABLE public.crm_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  brand text,
  category text,
  sku_prefix text,
  description text,
  hero_image_url text,
  status text NOT NULL DEFAULT 'Draft',
  tags text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.crm_products(id) ON DELETE CASCADE,
  variant_name text NOT NULL,
  sku text,
  color text,
  size text,
  mrp numeric(12,2),
  status text NOT NULL DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_product_packaging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.crm_products(id) ON DELETE CASCADE,
  pack_type text NOT NULL,
  units_per_pack integer,
  length_cm numeric(10,2),
  width_cm numeric(10,2),
  height_cm numeric(10,2),
  weight_g numeric(10,2),
  barcode text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_brand_positioning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES public.crm_products(id) ON DELETE CASCADE,
  tagline text,
  target_segment text,
  value_proposition text,
  brand_pillars text[] DEFAULT '{}',
  tone_of_voice text,
  key_messaging text,
  usps text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.crm_products(id) ON DELETE CASCADE,
  competitor_name text NOT NULL,
  logo_url text,
  source_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_competitor_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.crm_products(id) ON DELETE CASCADE,
  attribute_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_competitor_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute_id uuid NOT NULL REFERENCES public.crm_competitor_attributes(id) ON DELETE CASCADE,
  competitor_id uuid REFERENCES public.crm_competitors(id) ON DELETE CASCADE,
  value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_competitor_values_unique ON public.crm_competitor_values (attribute_id, COALESCE(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE public.crm_launch_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.crm_products(id) ON DELETE CASCADE,
  name text NOT NULL,
  launch_date date,
  status text NOT NULL DEFAULT 'Planned',
  owner text,
  channels text[] DEFAULT '{}',
  budget numeric(14,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_launch_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.crm_launch_plans(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_date date,
  owner text,
  status text NOT NULL DEFAULT 'Pending',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS + permissive policies for anon
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_products','crm_product_variants','crm_product_packaging',
    'crm_brand_positioning','crm_competitors','crm_competitor_attributes',
    'crm_competitor_values','crm_launch_plans','crm_launch_milestones'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "anon all %1$s" ON public.%1$I FOR ALL TO anon USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "auth all %1$s" ON public.%1$I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- updated_at triggers
CREATE TRIGGER trg_crm_products_updated BEFORE UPDATE ON public.crm_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_crm_product_variants_updated BEFORE UPDATE ON public.crm_product_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_crm_product_packaging_updated BEFORE UPDATE ON public.crm_product_packaging FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_crm_brand_positioning_updated BEFORE UPDATE ON public.crm_brand_positioning FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_crm_competitor_values_updated BEFORE UPDATE ON public.crm_competitor_values FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_crm_launch_plans_updated BEFORE UPDATE ON public.crm_launch_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_crm_launch_milestones_updated BEFORE UPDATE ON public.crm_launch_milestones FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
