-- Rollback of 20261110120500_facilities_supplies.sql (admin store, supply requests).
-- Purchase requests raised from the store stay (they live in the purchase flow).
DROP FUNCTION IF EXISTS public.facilities_store_reorder_to_prq(uuid[], uuid, text);
DROP FUNCTION IF EXISTS public.facilities_supply_request_acknowledge(uuid);
DROP FUNCTION IF EXISTS public.facilities_supply_request_issue(uuid, jsonb);
DROP FUNCTION IF EXISTS public.facilities_supply_request_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.facilities_supply_request_reject(uuid, text);
DROP FUNCTION IF EXISTS public.facilities_supply_request_approve(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.facilities_supply_request_submit(uuid);
DROP FUNCTION IF EXISTS public.facilities_supply_request_save(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.facilities_store_receive(uuid, numeric, text, uuid);
DROP FUNCTION IF EXISTS public.facilities_store_adjust(uuid, numeric, text, text);
DROP FUNCTION IF EXISTS public.facilities_store_item_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.facilities_store_post(uuid, text, numeric, text, uuid, text);
DROP FUNCTION IF EXISTS public.facilities_supply_request_notify_heads(public.facilities_supply_requests, text, text);
DROP FUNCTION IF EXISTS public.facilities_supply_request_label(public.facilities_supply_requests);
DROP VIEW IF EXISTS public.v_facilities_store_shortage;
DROP TABLE IF EXISTS public.facilities_supply_request_lines;
DROP TABLE IF EXISTS public.facilities_supply_requests;
DROP TABLE IF EXISTS public.facilities_store_ledger;
DROP TABLE IF EXISTS public.facilities_store_items;
DROP SEQUENCE IF EXISTS public.facilities_supply_request_seq;
DELETE FROM public.facilities_events WHERE document_type IN ('supply_request','store');
