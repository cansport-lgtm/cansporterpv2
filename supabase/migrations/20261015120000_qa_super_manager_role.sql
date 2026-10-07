-- ============================================================================
-- QA Super Manager role
-- ----------------------------------------------------------------------------
-- Everything the QA Manager can do in the Quality Assurance module, plus
-- setting the daily inspection targets (Daily Quality Plan and its templates).
-- Never deletes. Confined to the QA module + dashboard shell (enforced in the
-- app). Row-level rules are added in 20261015120100_qa_super_manager_rls.sql —
-- the new enum value can't be referenced in the same transaction that adds it.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'qa_super_manager';
