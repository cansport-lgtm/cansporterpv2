CREATE TABLE public.labour_productivity_edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.labour_productivity_targets(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.app_users(id),
  current_actual_quantity numeric NOT NULL DEFAULT 0,
  requested_actual_quantity numeric NOT NULL DEFAULT 0,
  current_remarks text,
  requested_remarks text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.app_users(id),
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lp_edit_requests_entry_status ON public.labour_productivity_edit_requests(entry_id, status);
CREATE INDEX idx_lp_edit_requests_status ON public.labour_productivity_edit_requests(status);

ALTER TABLE public.labour_productivity_edit_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to labour productivity edit requests"
ON public.labour_productivity_edit_requests
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_lp_edit_requests_updated_at
BEFORE UPDATE ON public.labour_productivity_edit_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();