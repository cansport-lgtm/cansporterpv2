-- ============================================================================
-- HR employees — two references
-- ----------------------------------------------------------------------------
-- Every staff member gives two references (blood relations). For each one HR
-- records:
--
--   name                 reference's full name
--   relationship         blood relation to the employee (father, brother, …)
--   cnic                 reference's CNIC (xxxxx-xxxxxxx-x)
--   contact              reference's phone number
--   police_verification  pending | verified | not_verified
--   verified_by          who carried out / signed off the verification
--
-- Fixed two references, so plain columns on employees (ref1_*, ref2_*).
-- All nullable: existing employees keep saving until HR fills them in.
-- ============================================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS ref1_name text,
  ADD COLUMN IF NOT EXISTS ref1_relationship text,
  ADD COLUMN IF NOT EXISTS ref1_cnic text,
  ADD COLUMN IF NOT EXISTS ref1_contact text,
  ADD COLUMN IF NOT EXISTS ref1_police_verification text,
  ADD COLUMN IF NOT EXISTS ref1_verified_by text,
  ADD COLUMN IF NOT EXISTS ref2_name text,
  ADD COLUMN IF NOT EXISTS ref2_relationship text,
  ADD COLUMN IF NOT EXISTS ref2_cnic text,
  ADD COLUMN IF NOT EXISTS ref2_contact text,
  ADD COLUMN IF NOT EXISTS ref2_police_verification text,
  ADD COLUMN IF NOT EXISTS ref2_verified_by text;

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_ref1_police_verification_check,
  ADD CONSTRAINT employees_ref1_police_verification_check
    CHECK (ref1_police_verification IS NULL
           OR ref1_police_verification IN ('pending', 'verified', 'not_verified')),
  DROP CONSTRAINT IF EXISTS employees_ref2_police_verification_check,
  ADD CONSTRAINT employees_ref2_police_verification_check
    CHECK (ref2_police_verification IS NULL
           OR ref2_police_verification IN ('pending', 'verified', 'not_verified'));
