-- Rollback for 20261009130000_store_pass_link_roles.sql
-- Removes the dispatch-side helpers and the linker-role check. Re-apply
-- sections 3 and 4 of 20261009120000_store_pass_simplify.sql afterwards
-- (store_pass_link_dispatches, store_pass_save, store_pass_issue) to get back
-- the store-role link permission and the automatic link by DC number.

DROP FUNCTION IF EXISTS public.store_pass_detach_dispatch(uuid);
DROP FUNCTION IF EXISTS public.store_pass_attach_dispatch(uuid, uuid);
DROP FUNCTION IF EXISTS public.store_pass_link_candidates(uuid);
DROP FUNCTION IF EXISTS public.store_pass_link_dispatches(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.store_pass_can_link();
