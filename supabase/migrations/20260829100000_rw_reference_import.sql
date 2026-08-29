-- Rejection & Wastage v1->v2 reference data import
-- Source: cansport_db_backup_20260826. Idempotent: ON CONFLICT (id) DO UPDATE.

INSERT INTO public.rw_dispositions (id,name,description,is_active,created_at,updated_at,name_urdu) VALUES
('8e984edb-f45e-4f27-b641-cccf56e80ea4','Scrap',NULL,true,'2026-06-14 08:39:58.534441+00','2026-06-14 09:07:27.289014+00','ضائع'),
('5f6f12e3-06ea-429f-9131-2d5c7df06f1f','Rework',NULL,true,'2026-06-14 08:39:58.534441+00','2026-06-14 09:07:27.289014+00','دوبارہ کام'),
('4439d480-c191-48cb-bd14-ba3bad4912c2','Use-as-is',NULL,true,'2026-06-14 08:39:58.534441+00','2026-06-14 09:07:27.289014+00','جوں کا توں استعمال'),
('3f2c06f5-eefa-425b-8f71-4505affa58a2','Return to Supplier',NULL,true,'2026-06-14 08:39:58.534441+00','2026-06-14 09:07:27.289014+00','سپلائر کو واپسی'),
('56411555-c35b-4960-9b9c-2dc472f6aa57','Quarantine',NULL,true,'2026-06-14 08:39:58.534441+00','2026-06-14 09:07:27.289014+00','علیحدہ/قرنطینہ')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,is_active=EXCLUDED.is_active,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,name_urdu=EXCLUDED.name_urdu;

INSERT INTO public.rw_reasons (id,name,type,category,is_active,created_at,updated_at) VALUES
('1fc7d9e4-f69e-4e52-a253-88c5aae8333f','hardness issue ','leakage',NULL,true,'2026-06-13 15:08:47.690794+00','2026-06-13 15:08:47.690794+00'),
('b9e0a4d3-265c-4337-8e39-c980e0fe36cd','solution pak gaya tha','wastage',NULL,true,'2026-06-14 10:02:15.92793+00','2026-06-14 10:02:15.92793+00'),
('bd61bdb9-8b6a-4736-ba48-4b4491bb345b','coly masam','leakage',NULL,true,'2026-06-14 10:32:02.84621+00','2026-06-14 10:32:02.84621+00'),
('9522e4a4-2cda-4098-ac81-81bc269bc3d9','coly blast pakai taiz','leakage',NULL,true,'2026-06-14 10:32:14.993416+00','2026-06-14 10:32:14.993416+00'),
('a3855eb9-49c7-434d-a0e3-83eb129847d1','compound pak gaya','wastage',NULL,true,'2026-06-14 10:33:33.223774+00','2026-06-14 10:33:33.223774+00'),
('c1788a20-f3b2-4ee6-8a93-27cf9cc9896e','Jorr fault','leakage',NULL,true,'2026-06-16 06:25:44.235559+00','2026-06-16 06:25:44.235559+00'),
('2edef6b9-2051-49f5-8689-5daf61b704f3','Kacha jorr','leakage',NULL,true,'2026-06-16 06:26:00.878926+00','2026-06-16 06:26:00.878926+00'),
('70a998dc-d26f-43ca-95dc-f5cb19865b67','Solution dhabba','rejection',NULL,true,'2026-06-16 13:15:51.590642+00','2026-06-16 13:15:51.590642+00'),
('2d33cce9-eb14-43bb-8c72-242d21ca3c10','Katchi dori issue','rejection',NULL,true,'2026-06-16 13:16:01.030415+00','2026-06-16 13:16:01.030415+00'),
('f06cc512-e299-41df-85da-07d4b822efaf','Gas girnai ka dhabba ','rejection',NULL,true,'2026-06-16 13:16:10.31511+00','2026-06-16 13:16:10.31511+00'),
('5b021178-3ffa-4847-8cbb-fe28ac34b5b1','dori crack','rejection',NULL,true,'2026-06-29 11:52:05.289594+00','2026-06-29 11:52:05.289594+00'),
('058ddfe6-a205-492f-8632-4e42f11c250f','Ghisai fault','leakage',NULL,true,'2026-07-09 13:25:53.840591+00','2026-07-09 13:25:53.840591+00')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,category=EXCLUDED.category,is_active=EXCLUDED.is_active,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at;

INSERT INTO public.rw_units (id,symbol,name,is_active,created_at,updated_at) VALUES
('4c78db09-f577-4c70-9a37-faa34686df3b','pcs','Pieces',true,'2026-06-13 14:06:59.01339+00','2026-06-13 14:06:59.01339+00'),
('c85b0f7f-c83a-49b2-82c3-0dc24847198f','dozen','Dozen',true,'2026-06-13 14:06:59.01339+00','2026-06-13 14:06:59.01339+00'),
('bbe04995-8321-4418-ac75-2d503dc1a9bf','kg','Kilogram',true,'2026-06-13 14:06:59.01339+00','2026-06-13 14:06:59.01339+00'),
('bddf0b69-bd37-43ed-b661-df4d13eef2de','gram','Gram',true,'2026-06-13 14:06:59.01339+00','2026-06-13 14:06:59.01339+00'),
('aeebe089-ed71-4ef4-a3d4-891bc8ec2680','ltr','Litre',true,'2026-06-13 14:06:59.01339+00','2026-06-13 14:06:59.01339+00')
ON CONFLICT (id) DO UPDATE SET symbol=EXCLUDED.symbol,name=EXCLUDED.name,is_active=EXCLUDED.is_active,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at;
