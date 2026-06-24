-- Distributor Order Management module — Phase 1 (foundation).
-- A separate module the company gives to its distributors' sales teams. Each
-- distributor's users only ever see their own distributor's data; company staff
-- (super_admin/admin) can see everything. Isolation is enforced in the app layer
-- by filtering every query on distributor_id (consistent with the rest of the app,
-- which uses permissive RLS + a public anon key).
--
-- This migration adds:
--   1. distributors                 — the distributor companies (super-admin managed)
--   2. app_users.distributor_id     — links a user to exactly one distributor (NULL = company staff)
--   3. distributor_customers        — each distributor's OWN customers (separate from public.customers)
-- plus updated_at triggers, anon-auth RLS, and indexes. Later phases add the
-- distributor product catalog, orders, approvals and dispatch sheet.

-- =====================================================================
-- 1. distributors
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.distributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  city text,
  area text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distributors_code_key UNIQUE (code)
);

-- =====================================================================
-- 2. app_users.distributor_id  (which distributor a user belongs to)
-- =====================================================================
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS distributor_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'app_users_distributor_id_fkey'
      AND table_name = 'app_users'
  ) THEN
    ALTER TABLE public.app_users
      ADD CONSTRAINT app_users_distributor_id_fkey
      FOREIGN KEY (distributor_id) REFERENCES public.distributors(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_app_users_distributor_id
  ON public.app_users (distributor_id);

-- =====================================================================
-- 3. distributor_customers  (a distributor's own customers)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.distributor_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id uuid NOT NULL,
  code text,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  city text,
  area text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distributor_customers_distributor_id_fkey
    FOREIGN KEY (distributor_id) REFERENCES public.distributors(id) ON DELETE CASCADE,
  CONSTRAINT distributor_customers_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL,
  -- Customer codes are unique within a distributor, not globally.
  CONSTRAINT distributor_customers_dist_code_key UNIQUE (distributor_id, code)
);

CREATE INDEX IF NOT EXISTS idx_distributor_customers_distributor_id
  ON public.distributor_customers (distributor_id);

-- =====================================================================
-- 4. updated_at triggers
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['distributors','distributor_customers'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I;', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t, t);
  END LOOP;
END $$;

-- =====================================================================
-- 5. RLS: anon-auth model (Allow all TO public) — same as every other module.
--    Per-distributor isolation is enforced in the application layer.
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['distributors','distributor_customers'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Allow all for %s" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END $$;
