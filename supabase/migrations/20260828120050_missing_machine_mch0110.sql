-- Machine MCH-0110 (TUMBLER BALL DRUM) was missing from the Machine Monitor
-- import but is referenced by maintenance work orders. Idempotent.
INSERT INTO public.machines (id,code,name,department_id,machine_type,manufacturer,model,serial_number,installation_date,status,specifications,notes,is_active,created_at,updated_at) VALUES
('1668c74c-fbb7-442c-a0c1-bafa41671293','MCH-0110','TUMBLER BALL DRUM','eba4f888-7289-4e1d-a1c9-1a03ebafd13a','TUMBLER','LOCAL',NULL,NULL,'2026-07-25','operational',NULL,NULL,true,'2026-07-24 04:36:11.551363+00','2026-07-24 04:36:11.551363+00')
ON CONFLICT (id) DO NOTHING;
