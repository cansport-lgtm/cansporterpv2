-- ============================================================================
-- R&W ball inventory — do not fight the production posting lock
-- ----------------------------------------------------------------------------
-- production_entries carries enforce_production_entry_posting_lock (added in
-- 20260801130000): once an entry is 'Posted', any change to its data raises.
-- quantity_rejected and quantity_ok are exactly the columns
-- rw_apportion_production_rejected writes, so a checker saving a count for a day
-- whose production entry was already posted would hit that exception — and the
-- failure would land on the checker's screen, on the primary entry path.
--
-- Posting is a deliberate "this is final" act, gated behind the production
-- approve permission. The right answer is not to force the derivation through
-- it: it is to leave posted entries alone and make the divergence visible, so
-- somebody with that permission decides whether to unpost.
--
-- If any row in a production key is posted the WHOLE key is skipped, never
-- partially rewritten — apportioning the day's defects across only the
-- unposted rows would inflate them and quietly misstate the split.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rw_apportion_production_rejected(
  p_date date, p_shift text, p_department uuid, p_sub_department uuid, p_grade uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_qty numeric;
  v_locked boolean;
BEGIN
  IF p_date < public.rw_ball_cutover() OR p_grade IS NULL THEN
    RETURN;
  END IF;

  -- Cheap-ball output rows are left exactly as production entered them.
  IF public.rw_is_defect_output_grade(p_grade) THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.production_entries pe
     WHERE pe.entry_date = p_date
       AND pe.shift = p_shift
       AND pe.department_id = p_department
       AND COALESCE(pe.sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_sub_department, '00000000-0000-0000-0000-000000000000'::uuid)
       AND pe.grade_id = p_grade
       AND pe.status = 'Posted'
  ) INTO v_locked;

  -- Posted means posted. v_rw_posted_entry_conflicts reports the gap instead.
  IF v_locked THEN
    RETURN;
  END IF;

  v_qty := public.rw_defect_qty_for_production(
    p_date, p_shift, p_department, p_sub_department, p_grade);

  WITH target AS (
    SELECT pe.id,
           COALESCE(pe.quantity_produced, 0) AS qp,
           SUM(COALESCE(pe.quantity_produced, 0)) OVER (ORDER BY pe.created_at, pe.id) AS cum,
           SUM(COALESCE(pe.quantity_produced, 0)) OVER ()                              AS tot,
           ROW_NUMBER() OVER (ORDER BY pe.created_at, pe.id)                           AS rn
      FROM public.production_entries pe
     WHERE pe.entry_date = p_date
       AND pe.shift = p_shift
       AND pe.department_id = p_department
       AND COALESCE(pe.sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_sub_department, '00000000-0000-0000-0000-000000000000'::uuid)
       AND pe.grade_id = p_grade
  ), alloc AS (
    SELECT id, qp,
           CASE
             WHEN tot > 0 THEN ROUND(v_qty * cum / tot) - ROUND(v_qty * (cum - qp) / tot)
             WHEN rn = 1  THEN v_qty
             ELSE 0
           END AS rej
      FROM target
  )
  UPDATE public.production_entries pe
     SET quantity_rejected = a.rej,
         quantity_ok       = GREATEST(a.qp - a.rej, 0),
         updated_at        = now()
    FROM alloc a
   WHERE pe.id = a.id
     AND (pe.quantity_rejected IS DISTINCT FROM a.rej
       OR pe.quantity_ok       IS DISTINCT FROM GREATEST(a.qp - a.rej, 0));
END;
$$;

-- Posted entries whose rejected figure no longer matches the checker's count.
-- Someone with the production approve permission unposts, and it updates.
CREATE OR REPLACE VIEW public.v_rw_posted_entry_conflicts
WITH (security_invoker = on) AS
SELECT pe.entry_date,
       pe.shift,
       pe.department_id,
       d.name                                    AS department_name,
       pe.grade_id,
       g.code                                    AS grade_code,
       SUM(COALESCE(pe.quantity_rejected, 0))    AS posted_rejected,
       public.rw_defect_qty_for_production(
         pe.entry_date, pe.shift, pe.department_id, pe.sub_department_id, pe.grade_id
       )                                         AS counted_rejected,
       public.rw_defect_qty_for_production(
         pe.entry_date, pe.shift, pe.department_id, pe.sub_department_id, pe.grade_id
       ) - SUM(COALESCE(pe.quantity_rejected, 0)) AS variance_qty,
       COUNT(*)                                  AS posted_rows
  FROM public.production_entries pe
  JOIN public.production_departments d ON d.id = pe.department_id
  JOIN public.grades g                 ON g.id = pe.grade_id
 WHERE pe.status = 'Posted'
   AND pe.entry_date >= public.rw_ball_cutover()
   AND NOT public.rw_is_defect_output_grade(pe.grade_id)
 GROUP BY pe.entry_date, pe.shift, pe.department_id, d.name,
          pe.grade_id, g.code, pe.sub_department_id
HAVING public.rw_defect_qty_for_production(
         pe.entry_date, pe.shift, pe.department_id, pe.sub_department_id, pe.grade_id
       ) IS DISTINCT FROM SUM(COALESCE(pe.quantity_rejected, 0));

COMMENT ON VIEW public.v_rw_posted_entry_conflicts IS
  'Posted production entries whose rejected figure no longer agrees with the floor count. The posting lock deliberately keeps them frozen, so these need an unpost by someone with the production approve permission before they will update.';

GRANT SELECT ON public.v_rw_posted_entry_conflicts TO anon, authenticated, service_role;
