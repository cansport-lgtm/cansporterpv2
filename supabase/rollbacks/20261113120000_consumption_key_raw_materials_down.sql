-- Rollback for 20261113120000_consumption_key_raw_materials.sql
-- Drops the key raw materials list (the list is lost; raw materials are untouched).

DROP FUNCTION IF EXISTS public.consumption_set_key_raw_materials(uuid[]);
DROP TABLE IF EXISTS public.consumption_key_raw_materials;
