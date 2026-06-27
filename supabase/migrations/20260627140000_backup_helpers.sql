-- ============================================================
-- Backup helper functions (used by the `db-backup` Edge Function)
--
-- Two SECURITY DEFINER helpers that the service-role-backed Edge Function calls
-- to produce a live backup:
--   • backup_list_tables() — all base tables in the public schema
--   • backup_schema_sql()  — a best-effort schema DDL dump (enums, tables,
--     constraints, indexes, functions, views, triggers, RLS policies)
--
-- These expose full schema metadata, so EXECUTE is revoked from anon/
-- authenticated and granted only to service_role (the Edge Function).
-- ============================================================

CREATE OR REPLACE FUNCTION public.backup_list_tables()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(array_agg(c.relname ORDER BY c.relname), '{}')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r';
$$;

CREATE OR REPLACE FUNCTION public.backup_schema_sql()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_out text := '';
  r record;
BEGIN
  v_out := v_out || '-- Schema backup generated ' || now()::text || E'\n';
  v_out := v_out || '-- Best-effort DDL. Restore order may need adjustment for cross-object deps.' || E'\n\n';

  -- ENUM types
  FOR r IN
    SELECT t.typname,
           string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname
  LOOP
    v_out := v_out || format('CREATE TYPE public.%I AS ENUM (%s);', r.typname, r.labels) || E'\n';
  END LOOP;
  v_out := v_out || E'\n';

  -- TABLES (columns only; constraints added below)
  FOR r IN
    SELECT c.relname AS table_name,
      string_agg(
        '  ' || quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod)
        || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
        || CASE WHEN ad.adbin IS NOT NULL THEN ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid) ELSE '' END,
        E',\n' ORDER BY a.attnum
      ) AS cols
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    GROUP BY c.relname
    ORDER BY c.relname
  LOOP
    v_out := v_out || format('CREATE TABLE public.%I (', r.table_name) || E'\n' || r.cols || E'\n);' || E'\n\n';
  END LOOP;

  -- CONSTRAINTS (PK / UNIQUE / FK / CHECK)
  FOR r IN
    SELECT con.conrelid::regclass::text AS tbl, con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_namespace n ON n.oid = con.connamespace
    JOIN pg_class c ON c.oid = con.conrelid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY con.conrelid::regclass::text, con.contype DESC
  LOOP
    v_out := v_out || format('ALTER TABLE %s ADD CONSTRAINT %I %s;', r.tbl, r.conname, r.def) || E'\n';
  END LOOP;
  v_out := v_out || E'\n';

  -- INDEXES (excluding those backing constraints)
  FOR r IN
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname NOT IN (
        SELECT con.conname FROM pg_constraint con
        JOIN pg_namespace n ON n.oid = con.connamespace WHERE n.nspname = 'public'
      )
    ORDER BY indexname
  LOOP
    v_out := v_out || r.indexdef || ';' || E'\n';
  END LOOP;
  v_out := v_out || E'\n';

  -- FUNCTIONS / PROCEDURES
  FOR r IN
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    ORDER BY p.proname
  LOOP
    v_out := v_out || r.def || E';\n\n';
  END LOOP;

  -- VIEWS
  FOR r IN
    SELECT table_name, pg_get_viewdef(format('public.%I', table_name)::regclass, true) AS def
    FROM information_schema.views
    WHERE table_schema = 'public'
    ORDER BY table_name
  LOOP
    v_out := v_out || format('CREATE OR REPLACE VIEW public.%I AS %s', r.table_name, r.def) || E'\n\n';
  END LOOP;

  -- TRIGGERS
  FOR r IN
    SELECT pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY c.relname
  LOOP
    v_out := v_out || r.def || ';' || E'\n';
  END LOOP;
  v_out := v_out || E'\n';

  -- RLS POLICIES
  FOR r IN
    SELECT policyname, tablename, permissive, cmd, qual, with_check, roles
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  LOOP
    v_out := v_out || format(
      'CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s;',
      r.policyname, r.tablename, r.permissive, r.cmd,
      array_to_string(r.roles, ', '),
      CASE WHEN r.qual IS NOT NULL THEN ' USING (' || r.qual || ')' ELSE '' END,
      CASE WHEN r.with_check IS NOT NULL THEN ' WITH CHECK (' || r.with_check || ')' ELSE '' END
    ) || E'\n';
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.backup_list_tables() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backup_schema_sql() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_list_tables() TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_schema_sql() TO service_role;
