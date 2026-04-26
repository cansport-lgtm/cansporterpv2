-- Add area column to customers table
ALTER TABLE public.customers 
ADD COLUMN area character varying(100);