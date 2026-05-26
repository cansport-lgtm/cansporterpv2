INSERT INTO public.crm_marketing_kpi_targets ("id", "month", "kpi_key", "target_value", "notes", "created_at", "updated_at") VALUES
  ('c782aaa8-1189-47ff-b53d-fd8a03a11a6e','2026-03-31','new_leads','50',NULL,'2026-05-15 20:35:32.559782+00','2026-05-15 20:36:12.393126+00'),
  ('315f812f-01ed-4912-8845-542d78d04d48','2026-03-31','qualified_leads','20',NULL,'2026-05-15 20:36:12.393126+00','2026-05-15 20:36:12.393126+00'),
  ('45222ea3-ff11-48f5-8f9f-3098d0d946ef','2026-03-31','avg_leads_per_day','2',NULL,'2026-05-15 20:36:12.393126+00','2026-05-15 20:36:12.393126+00') ON CONFLICT DO NOTHING;
