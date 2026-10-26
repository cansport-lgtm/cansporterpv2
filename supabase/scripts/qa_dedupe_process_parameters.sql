-- One-off cleanup for duplicated QA process parameters.
--
-- The old "Manage Parameters" save re-inserted every parameter when the delete
-- was blocked by existing inspection readings, producing duplicate rows with the
-- same name under one process. This script keeps, per (process_id, name), the
-- copy that has inspection readings (or the oldest copy when none do) and marks
-- the other copies inactive. Nothing is deleted.
--
-- 1. Run the PREVIEW query first and check the rows it lists.
-- 2. Run the UPDATE inside the transaction; ROLLBACK if the counts look wrong.

-- ---------- PREVIEW ----------
WITH ranked AS (
  SELECT
    p.id,
    p.process_id,
    p.parameter_name,
    p.created_at,
    (SELECT count(*) FROM public.qa_inspection_readings r WHERE r.parameter_id = p.id) AS reading_count,
    row_number() OVER (
      PARTITION BY p.process_id, lower(trim(p.parameter_name))
      ORDER BY
        (SELECT count(*) FROM public.qa_inspection_readings r WHERE r.parameter_id = p.id) DESC,
        p.created_at ASC
    ) AS rn
  FROM public.qa_process_parameters p
  WHERE p.is_active = true
)
SELECT ranked.*, pr.name AS process_name
FROM ranked
JOIN public.qa_processes pr ON pr.id = ranked.process_id
WHERE rn > 1
ORDER BY process_name, parameter_name, created_at;

-- ---------- APPLY ----------
BEGIN;

WITH ranked AS (
  SELECT
    p.id,
    row_number() OVER (
      PARTITION BY p.process_id, lower(trim(p.parameter_name))
      ORDER BY
        (SELECT count(*) FROM public.qa_inspection_readings r WHERE r.parameter_id = p.id) DESC,
        p.created_at ASC
    ) AS rn
  FROM public.qa_process_parameters p
  WHERE p.is_active = true
)
UPDATE public.qa_process_parameters p
SET is_active = false
FROM ranked
WHERE p.id = ranked.id AND ranked.rn > 1;

-- Re-number the surviving active parameters so the order is contiguous.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY process_id ORDER BY sequence_order, created_at) AS seq
  FROM public.qa_process_parameters
  WHERE is_active = true
)
UPDATE public.qa_process_parameters p
SET sequence_order = ordered.seq
FROM ordered
WHERE p.id = ordered.id;

-- Inspect, then COMMIT or ROLLBACK.
COMMIT;
