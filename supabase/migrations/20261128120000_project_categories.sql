-- Project Categories master + projects.category_id
-- Adds a master table for classifying projects (NPD, Sampling, ...) and an optional
-- FK on projects. Nullable so existing projects remain valid without a backfill.

CREATE TABLE IF NOT EXISTS public.project_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text UNIQUE,
  description text,
  sequence_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON public.project_categories;
CREATE POLICY "Public read" ON public.project_categories
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Full access" ON public.project_categories;
CREATE POLICY "Full access" ON public.project_categories
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_project_categories_updated_at ON public.project_categories;
CREATE TRIGGER update_project_categories_updated_at
  BEFORE UPDATE ON public.project_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.project_categories (name, code, sequence_order) VALUES
  ('New Product Development', 'NPD', 1),
  ('Sampling', 'SMP', 2),
  ('Packaging / Artwork', 'PKG', 3),
  ('Process Improvement', 'PIM', 4),
  ('Facility / Infrastructure', 'INF', 5),
  ('Marketing / Catalogue', 'MKT', 6),
  ('Customer-Specific', 'CUS', 7)
ON CONFLICT DO NOTHING;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS category_id uuid
  REFERENCES public.project_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_category_id ON public.projects(category_id);
