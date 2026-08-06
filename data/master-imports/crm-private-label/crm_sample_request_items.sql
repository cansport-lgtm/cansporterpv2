INSERT INTO public.crm_sample_request_items ("id", "request_id", "sample_item_id", "quantity", "remarks", "created_at") VALUES
  ('89b3b093-126c-4b07-a7cd-380baa6248b8','2cfc9227-12d5-4664-a77b-3a591620bd44','c0cd3e1e-98a4-476f-a024-e3559846657b','3.00',NULL,'2026-05-18 13:56:41.229668+00'),
  ('e65f0cde-b00b-43a4-88ce-b55229d9f063','15a9bf7c-7760-495d-ac99-879fd721f4a9','5c27985a-ae99-4a6c-9c1b-475f4ce87048','24.00',NULL,'2026-05-20 06:22:26.542862+00'),
  ('4aa9a03d-aee1-4a87-b25c-5ee44227efb2','86c41bc4-be7e-4fcd-9ed0-210869fd1765','e9ba2e2b-77cd-4b75-8118-a10c27904df3','3.00','full 72','2026-05-21 12:58:35.706569+00') ON CONFLICT DO NOTHING;
