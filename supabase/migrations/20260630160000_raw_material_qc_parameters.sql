-- ============================================================================
-- Raw-material QC checkpoints / parameters
-- ----------------------------------------------------------------------------
-- Lets admins define a flat list of quality checkpoints (parameters) per raw
-- material item. During a purchase QC inspection the inspector records a reading
-- against each checkpoint; the app evaluates in-spec / out-of-spec and stores it.
-- Mirrors the production-QA pattern (qa_process_parameters -> qa_inspection_readings).
-- ============================================================================

-- 1. Checkpoint master — one row per checkpoint per raw-material item.
CREATE TABLE IF NOT EXISTS public.raw_material_qc_parameters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    parameter_name VARCHAR(150) NOT NULL,
    parameter_type VARCHAR(20) NOT NULL DEFAULT 'numeric',  -- numeric | text | boolean | select
    unit VARCHAR(30),
    min_value NUMERIC,
    max_value NUMERIC,
    expected_value TEXT,        -- expected value for text/boolean, or expected option for select
    options JSONB,              -- choices for select-type parameters
    is_required BOOLEAN NOT NULL DEFAULT true,
    sequence_order INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rm_qc_parameters_item
  ON public.raw_material_qc_parameters(item_id);

ALTER TABLE public.raw_material_qc_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on raw_material_qc_parameters" ON public.raw_material_qc_parameters;
CREATE POLICY "Allow all operations on raw_material_qc_parameters"
  ON public.raw_material_qc_parameters FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_raw_material_qc_parameters_updated_at ON public.raw_material_qc_parameters;
CREATE TRIGGER update_raw_material_qc_parameters_updated_at
  BEFORE UPDATE ON public.raw_material_qc_parameters
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Inspection readings — actual value recorded per checkpoint per inspected line.
-- The checkpoint name + spec are snapshotted so editing/removing a checkpoint later
-- never rewrites the history of past inspections.
CREATE TABLE IF NOT EXISTS public.purchase_qc_inspection_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_item_id UUID NOT NULL REFERENCES public.purchase_qc_inspection_items(id) ON DELETE CASCADE,
    parameter_id UUID REFERENCES public.raw_material_qc_parameters(id) ON DELETE SET NULL,
    parameter_name VARCHAR(150) NOT NULL,
    parameter_type VARCHAR(20) NOT NULL DEFAULT 'numeric',
    unit VARCHAR(30),
    min_value NUMERIC,
    max_value NUMERIC,
    expected_value TEXT,
    value_number NUMERIC,
    value_text TEXT,
    value_boolean BOOLEAN,
    is_within_spec BOOLEAN,
    is_required BOOLEAN NOT NULL DEFAULT true,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_qc_inspection_readings_item
  ON public.purchase_qc_inspection_readings(inspection_item_id);

ALTER TABLE public.purchase_qc_inspection_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on purchase_qc_inspection_readings" ON public.purchase_qc_inspection_readings;
CREATE POLICY "Allow all operations on purchase_qc_inspection_readings"
  ON public.purchase_qc_inspection_readings FOR ALL USING (true) WITH CHECK (true);
