INSERT INTO public.crm_sample_items ("id", "product_id", "variant_id", "sku", "unit", "reorder_level", "is_active", "notes", "created_at", "updated_at") VALUES
  ('c0cd3e1e-98a4-476f-a024-e3559846657b','b517b4ef-9646-4c34-90f6-cd5b9235fc4d',NULL,NULL,'pcs','6.00','t',NULL,'2026-05-18 13:55:48.234069+00','2026-05-18 13:55:48.234069+00'),
  ('5c27985a-ae99-4a6c-9c1b-475f4ce87048','27200ad7-df5c-432e-b581-73eadaf17cdb','a7d8ed30-ceda-447d-a198-8aadf81771f1',NULL,'pcs','0.00','t',NULL,'2026-05-19 08:30:35.301341+00','2026-05-19 08:30:35.301341+00'),
  ('e9ba2e2b-77cd-4b75-8118-a10c27904df3','394c0290-f165-4308-b0a2-4243d79e2fe9','1876fd09-65e6-4ed8-bde1-be6fe075d960',NULL,'pcs','0.00','t',NULL,'2026-05-19 08:30:58.694253+00','2026-05-19 08:30:58.694253+00') ON CONFLICT DO NOTHING;
