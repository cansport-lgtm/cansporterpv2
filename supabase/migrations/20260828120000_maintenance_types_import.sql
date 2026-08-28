-- Maintenance Types v1->v2 Migration (20260828)
-- Imports 4 maintenance type records from v1
-- Idempotent: uses ON CONFLICT DO NOTHING

INSERT INTO public.maintenance_types (id,code,name,description,is_active,created_at) VALUES
  ('9825ece4-a6b8-4c21-be85-c8acea9076d7','PM','Preventive Maintenance','Scheduled maintenance to prevent breakdowns',true,'2026-01-10 18:46:25.835255+00'),
  ('d083fb1d-7f6c-4a8d-9943-e3efa9216ba9','CM','Corrective Maintenance','Repairs after identifying issues',true,'2026-01-10 18:46:25.835255+00'),
  ('e50b0fba-b672-4cce-93c1-b514be8361ca','BM','Breakdown Maintenance','Emergency repairs after equipment failure',true,'2026-01-10 18:46:25.835255+00'),
  ('85797cb8-1fbf-45dd-9a3b-0963bb8939f3','PDM','Predictive Maintenance','Maintenance based on condition monitoring',true,'2026-01-10 18:46:25.835255+00')
ON CONFLICT (id) DO NOTHING;
