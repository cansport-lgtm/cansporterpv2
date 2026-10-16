-- Rollback for 20261025120000_private_label_floor_pin.sql
DROP FUNCTION IF EXISTS public.pljo_floor_log_printed(text, uuid);
DROP FUNCTION IF EXISTS public.pljo_floor_order_detail(text, uuid);
DROP FUNCTION IF EXISTS public.pljo_floor_orders(text);
DROP FUNCTION IF EXISTS public.pljo_floor_check_pin(text);
DROP FUNCTION IF EXISTS public.pljo_floor_pin_status();
DROP FUNCTION IF EXISTS public.pljo_floor_set_pin(text);
DROP TABLE IF EXISTS public.private_label_floor_pin_failures;
DROP TABLE IF EXISTS public.private_label_floor_settings;
