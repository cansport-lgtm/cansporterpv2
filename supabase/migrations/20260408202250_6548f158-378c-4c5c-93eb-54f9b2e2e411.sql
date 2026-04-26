
ALTER TABLE public.labour_mph_authorized DROP CONSTRAINT IF EXISTS labour_mph_authorized_department_id_month_year_key;
ALTER TABLE public.labour_mph_authorized DROP COLUMN IF EXISTS month;
ALTER TABLE public.labour_mph_authorized DROP COLUMN IF EXISTS year;
ALTER TABLE public.labour_mph_authorized ADD COLUMN entry_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public.labour_mph_authorized ADD CONSTRAINT labour_mph_authorized_dept_date_key UNIQUE(department_id, entry_date);
