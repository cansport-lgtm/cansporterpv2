-- ============================================================================
-- Help Desk Manager role
-- ----------------------------------------------------------------------------
-- A single-purpose role that can manage all help desk tickets (view, assign,
-- comment, change status/priority, resolve) via /helpdesk/manage — access to
-- that page was previously restricted to super_admin only. Confined to the
-- Help Desk module + dashboard shell (enforced in the app via route lockdown).
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'helpdesk_manager';
