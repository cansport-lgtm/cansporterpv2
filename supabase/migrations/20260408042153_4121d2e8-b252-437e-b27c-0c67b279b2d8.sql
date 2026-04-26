ALTER TABLE public.employees 
ADD COLUMN duty_start_time time DEFAULT '09:00',
ADD COLUMN duty_end_time time DEFAULT '18:00',
ADD COLUMN duty_hours numeric DEFAULT 8;