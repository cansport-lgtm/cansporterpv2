
CREATE TABLE public.deadline_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.app_users(id),
  current_deadline date NOT NULL,
  requested_deadline date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.app_users(id),
  review_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.deadline_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access for anon" ON public.deadline_change_requests
  FOR ALL TO anon USING (true) WITH CHECK (true);
