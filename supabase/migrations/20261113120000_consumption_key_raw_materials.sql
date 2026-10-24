-- ============================================================================
-- Key Raw Materials: one shared, ordered list of the raw materials checked
-- every day. The Key Raw Materials portal manages it and the Material Usage
-- Report's Single Day view loads it in one click.
--
-- Kept separate from consumption_raw_materials.priority, which drives
-- reordering, not reporting.
--
-- The table is read-only to clients (same pattern as purchase_requests): the
-- list is only changed through consumption_set_key_raw_materials(), which
-- checks the caller is a super admin (app_user_id() from the x-app-user-id
-- header, roles from user_roles).
--
-- Removing a material only stamps removed_at (no DELETE): the list keeps a
-- history, and the Supabase apply tool stalls on statements with DELETE.
--
-- Applied to the live project in parts (consumption_key_raw_materials_1_table,
-- _3_removed_at, _4_set_fn).
--
-- Rollback: supabase/rollbacks/20261113120000_consumption_key_raw_materials_down.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.consumption_key_raw_materials (
  raw_material_id uuid PRIMARY KEY REFERENCES public.consumption_raw_materials(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  added_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE INDEX IF NOT EXISTS consumption_key_raw_materials_sort_idx ON public.consumption_key_raw_materials (sort_order);

ALTER TABLE public.consumption_key_raw_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read consumption_key_raw_materials" ON public.consumption_key_raw_materials
  FOR SELECT TO public USING (true);
GRANT SELECT ON public.consumption_key_raw_materials TO anon, authenticated, service_role;
GRANT ALL ON public.consumption_key_raw_materials TO service_role;

-- Replace the whole list; array order becomes the display order. Materials
-- left off are stamped removed_at; materials already on the list keep who
-- added them and when, and a re-added material starts afresh.
CREATE OR REPLACE FUNCTION public.consumption_set_key_raw_materials(p_raw_material_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can change the key raw materials list.';
  END IF;

  -- De-duplicate while keeping first-seen order.
  SELECT COALESCE(array_agg(id ORDER BY pos), '{}')
    INTO v_ids
    FROM (
      SELECT id, MIN(pos) AS pos
        FROM unnest(COALESCE(p_raw_material_ids, '{}')) WITH ORDINALITY AS t(id, pos)
       WHERE id IS NOT NULL
       GROUP BY id
    ) d;

  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) AS t(id)
     WHERE NOT EXISTS (SELECT 1 FROM public.consumption_raw_materials m WHERE m.id = t.id)
  ) THEN
    RAISE EXCEPTION 'One of the selected raw materials no longer exists.';
  END IF;

  UPDATE public.consumption_key_raw_materials
     SET removed_at = now()
   WHERE removed_at IS NULL
     AND NOT (raw_material_id = ANY (v_ids));

  INSERT INTO public.consumption_key_raw_materials (raw_material_id, sort_order, added_by)
  SELECT t.id, t.pos::integer, public.app_user_id()
    FROM unnest(v_ids) WITH ORDINALITY AS t(id, pos)
  ON CONFLICT (raw_material_id) DO UPDATE
    SET sort_order = EXCLUDED.sort_order,
        removed_at = NULL,
        added_by = CASE WHEN consumption_key_raw_materials.removed_at IS NULL
                        THEN consumption_key_raw_materials.added_by ELSE EXCLUDED.added_by END,
        created_at = CASE WHEN consumption_key_raw_materials.removed_at IS NULL
                          THEN consumption_key_raw_materials.created_at ELSE now() END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consumption_set_key_raw_materials(uuid[]) TO anon, authenticated, service_role;
