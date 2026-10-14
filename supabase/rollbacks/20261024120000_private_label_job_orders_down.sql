-- Rollback for 20261024120000_private_label_job_orders.sql
-- Removes Private Label Job Orders, their sizes, logos table, log and counter.
-- Normal job orders, grades, packing types and items are untouched.
-- Files in the private-label-logos bucket are kept; delete them from
-- Storage by hand if they are no longer needed.

-- These take the tables' row types, so they go before the tables.
DROP FUNCTION IF EXISTS public.pljo_header_view(public.private_label_job_orders);
DROP FUNCTION IF EXISTS public.pljo_item_view(public.private_label_job_order_items);

DROP TABLE IF EXISTS public.private_label_job_order_log;
DROP TABLE IF EXISTS public.private_label_job_order_attachments;
DROP TABLE IF EXISTS public.private_label_job_order_items;
DROP TABLE IF EXISTS public.private_label_job_orders;
DROP TABLE IF EXISTS public.private_label_job_order_counters;
DROP TABLE IF EXISTS public.private_label_sizes;

DROP FUNCTION IF EXISTS public.pljo_log_printed(uuid);
DROP FUNCTION IF EXISTS public.pljo_assign_number();
DROP FUNCTION IF EXISTS public.pljo_log_header();
DROP FUNCTION IF EXISTS public.pljo_log_item();
DROP FUNCTION IF EXISTS public.pljo_attachment_set_uploader();
DROP FUNCTION IF EXISTS public.pljo_log_attachment_change();
DROP FUNCTION IF EXISTS public.pljo_guard_header();
DROP FUNCTION IF EXISTS public.pljo_guard_child();
DROP FUNCTION IF EXISTS public.pljo_diff(jsonb, jsonb, text[]);

DROP POLICY IF EXISTS "private_label_logos_storage_read" ON storage.objects;
DROP POLICY IF EXISTS "private_label_logos_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "private_label_logos_storage_delete" ON storage.objects;
