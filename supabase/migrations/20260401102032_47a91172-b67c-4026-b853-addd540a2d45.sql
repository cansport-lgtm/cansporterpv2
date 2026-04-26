ALTER TABLE public.sales_dispatches ADD COLUMN IF NOT EXISTS acknowledgement_date timestamptz;
ALTER TABLE public.sales_dispatches ADD COLUMN IF NOT EXISTS acknowledgement_doc_url text;
ALTER TABLE public.sales_dispatches ADD COLUMN IF NOT EXISTS receiver_name text;