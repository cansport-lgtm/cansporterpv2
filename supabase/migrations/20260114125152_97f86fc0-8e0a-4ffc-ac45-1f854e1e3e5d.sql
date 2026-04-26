-- Add assigned_to (technician) field to maintenance_schedules
ALTER TABLE public.maintenance_schedules 
ADD COLUMN assigned_to UUID REFERENCES public.app_users(id);

-- Add comment for clarity
COMMENT ON COLUMN public.maintenance_schedules.assigned_to IS 'Technician assigned to this PM schedule';