-- Rollback for 20261022120000_rw_downgrades.sql
-- Nothing else depends on downgrades (they never touch stock, the ledger or
-- production), so dropping the table loses only the downgrade forms themselves.

DROP FUNCTION IF EXISTS public.rw_downgrade_cancel(uuid);
DROP FUNCTION IF EXISTS public.rw_downgrade_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.rw_downgrade_submit(text, uuid, uuid, text, numeric, text, uuid, uuid, text, text, text, numeric, numeric);
DROP FUNCTION IF EXISTS public.rw_downgrade_notify(public.rw_downgrades, text, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.rw_downgrade_can(text);

DROP TABLE IF EXISTS public.rw_downgrades;
DROP SEQUENCE IF EXISTS public.rw_downgrade_seq;

DELETE FROM public.notifications WHERE reference_type = 'rw_downgrade';
