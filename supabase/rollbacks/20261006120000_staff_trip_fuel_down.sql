-- Rollback for 20261006120000_staff_trip_fuel.sql.
-- Vouchers and their events are dropped. The trip-odometer-photos bucket and
-- its files are kept (drop by hand if wanted).

DROP FUNCTION IF EXISTS public.staff_trip_fuel_settings_save(numeric, integer);
DROP FUNCTION IF EXISTS public.staff_trip_fuel_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.staff_trip_fuel_pay(uuid, text);
DROP FUNCTION IF EXISTS public.staff_trip_fuel_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.staff_trip_fuel_claim(uuid, text, numeric, numeric, numeric, text, text);
DROP FUNCTION IF EXISTS public.staff_trip_fuel_notify(public.staff_trip_fuel_vouchers, text, text, text, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.staff_trip_fuel_label(public.staff_trip_fuel_vouchers);
DROP FUNCTION IF EXISTS public.staff_trip_fuel_log(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.staff_trip_fuel_can(text);

DROP TABLE IF EXISTS public.staff_trip_fuel_events;
DROP TABLE IF EXISTS public.staff_trip_fuel_vouchers;
DROP SEQUENCE IF EXISTS public.staff_trip_fuel_number_seq;

ALTER TABLE public.staff_gate_pass_settings
  DROP COLUMN IF EXISTS fuel_rate_per_km,
  DROP COLUMN IF EXISTS fuel_max_km_per_trip;
