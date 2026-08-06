INSERT INTO public.grades ("id", "name", "code", "description", "is_active", "created_at") VALUES
  ('318cf7c3-869e-4f85-bc73-b43bc55ee2e5','LB','LB','Grade LB','t','2026-01-09 18:31:32.22223+00'),
  ('34f34148-d201-4959-adac-00e85a520569','FB','FB','Grade FB','t','2026-01-09 18:31:32.22223+00'),
  ('df5569b7-1842-45af-b963-635cf5a694a8','KB','KB','Grade KB','t','2026-01-09 18:31:32.22223+00'),
  ('487b7783-bb20-4d0c-8bea-efb39efa5b14','T','T','Grade T','t','2026-01-09 18:31:32.22223+00'),
  ('67aadb06-e18b-4e4f-a8d1-a334b429cc5f','VM','VM','Grade VM','t','2026-01-09 18:31:32.22223+00'),
  ('3975279b-d790-4ecf-99ca-14fcf7ec239b','V','V','Grade V','t','2026-01-09 18:31:32.22223+00'),
  ('87efe7e0-2f85-4d6d-a659-30ec37675f09','OX','OX','Grade OX','t','2026-01-12 13:43:28.047391+00'),
  ('d6b5a118-5869-4cef-9538-80a211f95d1c','Compound','Compound','Compounding','t','2026-01-13 18:36:04.464782+00'),
  ('1b498551-27fa-4492-97c7-b0957e92e894','solution','solution','soution','t','2026-01-16 03:26:46.784659+00'),
  ('ebd91f64-3473-4858-8e01-b46ba9f1792b','Kapra','Kapra ','Kapra','t','2026-01-16 06:34:55.850919+00'),
  ('9b37783e-1cd9-4486-a25b-44eeab5cdd2d','Leak ball','Leak ball','Leak balls','t','2026-01-17 08:08:39.067378+00'),
  ('b1c70fc2-82e3-466a-a910-2a456d1b9269','Rejection ','Rejection ',NULL,'t','2026-01-17 08:09:21.650397+00'),
  ('6f61f476-fbbc-4471-87f1-7a265b2a6814','H','H',NULL,'t','2026-05-11 09:47:23.479942+00') ON CONFLICT DO NOTHING;
