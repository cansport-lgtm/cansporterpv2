INSERT INTO public.crm_contacts ("id", "full_name", "designation", "company", "phone", "email", "customer_id", "notes", "created_at", "updated_at") VALUES
  ('3db4627a-8c7b-4713-85a6-9f98291beb61','akhter khan','ceo','power plus',NULL,NULL,NULL,NULL,'2026-04-17 18:59:29.541453+00','2026-04-17 18:59:29.541453+00'),
  ('989ed096-bf0e-467c-9625-3ae0ec615f5a','inayatullah','ceo','ghafoor sports',NULL,NULL,NULL,NULL,'2026-04-17 18:59:51.476576+00','2026-04-17 18:59:51.476576+00') ON CONFLICT DO NOTHING;
