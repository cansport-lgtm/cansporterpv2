-- Adds the standard three-tier role set for the Machine Monitor module, which
-- was left out when the per-module tiers were introduced.
--
--   machine_monitor_manager → view / create / edit / approve (no delete)
--   machine_monitor_officer → view / create / edit
--   machine_monitor_viewer  → view only

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'machine_monitor_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'machine_monitor_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'machine_monitor_viewer';
