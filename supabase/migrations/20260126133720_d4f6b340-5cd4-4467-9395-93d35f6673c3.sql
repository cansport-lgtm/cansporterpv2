-- Drop the old function without p_production_date parameter to resolve ambiguity
DROP FUNCTION IF EXISTS public.floor_inventory_execute_production(uuid, numeric, uuid, uuid, text);
