INSERT INTO public.crm_products ("id", "name", "brand", "category", "sku_prefix", "description", "hero_image_url", "status", "tags", "created_at", "updated_at") VALUES
  ('b517b4ef-9646-4c34-90f6-cd5b9235fc4d','Cancon Pro','cancon','professional cricket ball','70mm',NULL,NULL,'Active','{}','2026-05-16 08:03:53.386625+00','2026-05-16 08:03:53.386625+00'),
  ('824b2c5d-b47c-4e58-b8ce-78707b7c41dc','Cancon Pro 72','Cancon','professional tape cricket ball',NULL,NULL,NULL,'Draft','{}','2026-05-18 11:39:35.829691+00','2026-05-18 11:39:35.829691+00'),
  ('27200ad7-df5c-432e-b581-73eadaf17cdb','Aero padel ball','AERO',NULL,NULL,NULL,NULL,'Draft','{}','2026-05-18 11:40:13.063885+00','2026-05-18 11:40:13.063885+00'),
  ('394c0290-f165-4308-b0a2-4243d79e2fe9','VM 72 /70','Private label','PL ',NULL,NULL,NULL,'Active','{}','2026-05-15 20:38:01.956444+00','2026-05-20 07:07:39.133772+00') ON CONFLICT DO NOTHING;
