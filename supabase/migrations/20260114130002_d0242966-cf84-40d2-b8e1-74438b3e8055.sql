-- Add technician_name text columns to maintenance tables
ALTER TABLE public.maintenance_work_orders 
ADD COLUMN IF NOT EXISTS technician_name TEXT;

ALTER TABLE public.breakdown_logs 
ADD COLUMN IF NOT EXISTS technician_name TEXT;

ALTER TABLE public.maintenance_schedules 
ADD COLUMN IF NOT EXISTS technician_name TEXT;