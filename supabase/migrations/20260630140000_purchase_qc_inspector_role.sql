-- ============================================================================
-- Purchase QC Inspector role
-- ----------------------------------------------------------------------------
-- A single-purpose role that ONLY performs incoming raw-material quality
-- inspection for purchase orders and approves it. It is confined to the
-- Quality Inspection page (/purchase/qc) and never sees any prices/amounts
-- (enforced in the app via canViewPrices + route lockdown).
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'purchase_qc_inspector';
