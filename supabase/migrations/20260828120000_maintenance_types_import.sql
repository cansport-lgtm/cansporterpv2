-- Maintenance Types v1->v2 Migration (20260828)
-- Imports 4 maintenance type records from v1
-- Idempotent: uses ON CONFLICT DO NOTHING

INSERT INTO public.maintenance_types (id,code,name,description,is_active,created_at) VALUES
  ('a36ddeb7-4d6b-4f68-b865-04d3fb805c0a','PM','Preventive Maintenance','Scheduled maintenance to prevent breakdowns',true,'2026-01-10 18:46:25.835255+00'),
  ('a555e640-1a1a-43a2-b537-91667c24349e','CM','Corrective Maintenance','Repairs after identifying issues',true,'2026-01-10 18:46:25.835255+00'),
  ('f1a8f253-d2ab-4ab9-8bd5-2f6229da9b82','BM','Breakdown Maintenance','Emergency repairs after equipment failure',true,'2026-01-10 18:46:25.835255+00'),
  ('e29d16f9-72b0-4a86-b800-465abdb047e4','PDM','Predictive Maintenance','Maintenance based on condition monitoring',true,'2026-01-10 18:46:25.835255+00')
ON CONFLICT (code) DO NOTHING;
