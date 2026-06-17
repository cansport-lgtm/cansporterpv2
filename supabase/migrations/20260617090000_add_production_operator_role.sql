-- Production Operator role.
-- Full Production + Production Planning access. Can post (create) and edit entries,
-- but editing is restricted to a 48-hour window after creation (enforced in-app).
-- No delete or approve.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'production_operator';
