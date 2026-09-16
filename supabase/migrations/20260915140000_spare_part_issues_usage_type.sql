-- Add usage_type to spare_part_issues (present in v1 database; needed to
-- carry over v1 spare part issue data without loss).
ALTER TABLE public.spare_part_issues
  ADD COLUMN IF NOT EXISTS usage_type text DEFAULT 'maintenance'::text NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.spare_part_issues
    ADD CONSTRAINT spare_part_issues_usage_type_check
    CHECK (usage_type = ANY (ARRAY['maintenance'::text, 'new_machinery_development'::text]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
