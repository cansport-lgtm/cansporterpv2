-- QA process parameters: make the readings -> parameters relationship explicit
-- and support soft-deleting parameters instead of hard deletes.
--
-- Background: the Process Master "Manage Parameters" dialog used to delete all
-- parameters of a process and re-insert them. Once a parameter had inspection
-- readings the delete was rejected by the FK, the error was ignored, and the
-- re-insert created duplicate rows. The UI now updates in place and sets
-- is_active = false for removed parameters.

ALTER TABLE public.qa_process_parameters
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_qa_process_parameters_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qa_process_parameters_updated_at ON public.qa_process_parameters;
CREATE TRIGGER trg_qa_process_parameters_updated_at
  BEFORE UPDATE ON public.qa_process_parameters
  FOR EACH ROW
  EXECUTE FUNCTION public.set_qa_process_parameters_updated_at();

-- Make the FK behaviour explicit: a parameter with recorded readings can never
-- be hard-deleted. Retire it with is_active = false instead.
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT c.conname INTO fk_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.qa_inspection_readings'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'public.qa_process_parameters'::regclass
    AND a.attname = 'parameter_id'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.qa_inspection_readings DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE public.qa_inspection_readings
    ADD CONSTRAINT qa_inspection_readings_parameter_id_fkey
    FOREIGN KEY (parameter_id)
    REFERENCES public.qa_process_parameters (id)
    ON DELETE RESTRICT;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_qa_process_parameters_process_active
  ON public.qa_process_parameters (process_id, is_active, sequence_order);
