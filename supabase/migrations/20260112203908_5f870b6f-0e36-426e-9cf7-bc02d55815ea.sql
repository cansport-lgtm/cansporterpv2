-- Create customer_logos table for multiple logos per customer
CREATE TABLE public.customer_logos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    logo_url TEXT NOT NULL,
    label TEXT,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.app_users(id)
);

-- Enable RLS
ALTER TABLE public.customer_logos ENABLE ROW LEVEL SECURITY;

-- Create permissive RLS policies (app uses custom auth)
CREATE POLICY "Anyone can view customer logos"
ON public.customer_logos FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert customer logos"
ON public.customer_logos FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update customer logos"
ON public.customer_logos FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete customer logos"
ON public.customer_logos FOR DELETE
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_customer_logos_customer_id ON public.customer_logos(customer_id);