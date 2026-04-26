ALTER TABLE public.employees 
ADD COLUMN leave_quota_type text NOT NULL DEFAULT 'half_day';

-- Add validation trigger instead of CHECK constraint
CREATE OR REPLACE FUNCTION public.validate_leave_quota_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.leave_quota_type NOT IN ('half_day', 'full_day') THEN
    RAISE EXCEPTION 'leave_quota_type must be half_day or full_day';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_leave_quota_type
BEFORE INSERT OR UPDATE ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.validate_leave_quota_type();