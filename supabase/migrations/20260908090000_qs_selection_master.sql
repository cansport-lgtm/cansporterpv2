-- Quality Score: selection master for the entry-form dropdowns.
--
-- The Ball/Process entry context dropdowns (Department, Product, Grade) show every
-- active row from the global masters by default. This table lets a Quality Score
-- manager curate exactly which items appear in each dropdown: when a list has at
-- least one row here, only those items are offered; an empty list keeps the
-- show-everything default so the module never locks itself out.

CREATE TABLE IF NOT EXISTS public.qs_selection_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_type text NOT NULL CHECK (list_type IN ('department', 'product', 'grade')),
  ref_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_type, ref_id)
);

ALTER TABLE public.qs_selection_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for qs_selection_options" ON public.qs_selection_options;
CREATE POLICY "Allow all for qs_selection_options" ON public.qs_selection_options
  FOR ALL TO public USING (true) WITH CHECK (true);
