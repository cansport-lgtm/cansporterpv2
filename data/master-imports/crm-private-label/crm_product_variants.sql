INSERT INTO public.crm_product_variants ("id", "product_id", "variant_name", "sku", "color", "size", "mrp", "status", "created_at", "updated_at") VALUES
  ('1876fd09-65e6-4ed8-bde1-be6fe075d960','394c0290-f165-4308-b0a2-4243d79e2fe9','VM72- Green',NULL,'Green','72+',NULL,'Active','2026-05-16 06:12:27.825447+00','2026-05-16 06:12:27.825447+00'),
  ('cefb7687-9022-4d7e-88b7-cd052b6389b3','394c0290-f165-4308-b0a2-4243d79e2fe9','VM72-Yellow',NULL,'Yellow','72+',NULL,'Active','2026-05-16 06:12:57.935043+00','2026-05-16 06:12:57.935043+00'),
  ('9067ce98-ed66-4fb7-be85-145a1b65a4cc','27200ad7-df5c-432e-b581-73eadaf17cdb','Areo Premier',NULL,NULL,NULL,NULL,'Active','2026-05-19 06:45:31.568505+00','2026-05-19 06:45:31.568505+00'),
  ('22fb65e1-aa14-4ae4-b300-a2c6a0711bd1','27200ad7-df5c-432e-b581-73eadaf17cdb','Aero Club',NULL,NULL,NULL,'1400.00','Active','2026-05-19 06:45:14.935778+00','2026-05-19 08:12:35.70857+00'),
  ('a7d8ed30-ceda-447d-a198-8aadf81771f1','27200ad7-df5c-432e-b581-73eadaf17cdb','Aero Pro',NULL,NULL,NULL,'1500.00','Active','2026-05-19 06:45:43.991396+00','2026-05-19 08:13:00.141197+00') ON CONFLICT DO NOTHING;
