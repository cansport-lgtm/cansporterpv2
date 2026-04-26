-- Drop the existing unique constraint on code
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_code_key;

-- Add new unique constraint on code + sales_segment combination
ALTER TABLE public.customers ADD CONSTRAINT customers_code_segment_unique UNIQUE (code, sales_segment);