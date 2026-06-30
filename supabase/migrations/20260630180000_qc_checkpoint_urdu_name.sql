-- ============================================================================
-- Bilingual QC checkpoints — add an Urdu name alongside the English name.
-- ----------------------------------------------------------------------------
-- Inspectors on the floor read checkpoints in Urdu; admins still define the
-- English name. The Urdu name is optional and falls back to English when blank.
-- ============================================================================

ALTER TABLE public.raw_material_qc_parameters
  ADD COLUMN IF NOT EXISTS parameter_name_ur TEXT;

-- Snapshot the Urdu name onto readings too, so historical inspections keep the
-- exact wording shown at inspection time.
ALTER TABLE public.purchase_qc_inspection_readings
  ADD COLUMN IF NOT EXISTS parameter_name_ur TEXT;
