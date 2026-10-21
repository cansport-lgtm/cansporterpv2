-- Rollback of 20261110120400_facilities_assets.sql (office asset custody).
DROP FUNCTION IF EXISTS public.facilities_asset_mark_on_paper(uuid);
DROP FUNCTION IF EXISTS public.facilities_asset_acknowledge(uuid);
DROP FUNCTION IF EXISTS public.facilities_asset_move(jsonb);
DROP FUNCTION IF EXISTS public.facilities_my_employee_id();
DROP VIEW IF EXISTS public.v_facilities_asset_custody;
DROP TABLE IF EXISTS public.facilities_asset_movements;
DROP SEQUENCE IF EXISTS public.facilities_asset_movement_seq;
DELETE FROM public.facilities_events WHERE document_type = 'asset_movement';
