-- ============================================================
-- GRN attachments: supplier bills + stock photos uploaded against
-- a Goods Receipt Note. Files live in a public storage bucket so
-- that the existing GRN view dialog can show thumbnails / links
-- directly via the public URL.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.grn_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id      UUID NOT NULL REFERENCES public.goods_receipt_notes(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('bill', 'stock_photo', 'other')),
  file_path   TEXT NOT NULL,        -- key in storage.objects (bucket=grn-attachments)
  file_name   TEXT NOT NULL,        -- original upload name (for display + download)
  file_size   INT,
  mime_type   TEXT,
  uploaded_by UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grn_attachments_grn ON public.grn_attachments(grn_id);

ALTER TABLE public.grn_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "grn_attachments_select" ON public.grn_attachments;
CREATE POLICY "grn_attachments_select" ON public.grn_attachments FOR SELECT USING (true);
DROP POLICY IF EXISTS "grn_attachments_insert" ON public.grn_attachments;
CREATE POLICY "grn_attachments_insert" ON public.grn_attachments FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "grn_attachments_update" ON public.grn_attachments;
CREATE POLICY "grn_attachments_update" ON public.grn_attachments FOR UPDATE USING (true);
DROP POLICY IF EXISTS "grn_attachments_delete" ON public.grn_attachments;
CREATE POLICY "grn_attachments_delete" ON public.grn_attachments FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grn_attachments TO anon, authenticated, service_role;

-- Storage bucket (public so the view dialog can fetch thumbnails / direct links)
INSERT INTO storage.buckets (id, name, public)
VALUES ('grn-attachments', 'grn-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: anyone authenticated can upload + read inside this bucket
DROP POLICY IF EXISTS "grn_attachments_storage_read" ON storage.objects;
CREATE POLICY "grn_attachments_storage_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'grn-attachments');

DROP POLICY IF EXISTS "grn_attachments_storage_insert" ON storage.objects;
CREATE POLICY "grn_attachments_storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'grn-attachments');

DROP POLICY IF EXISTS "grn_attachments_storage_delete" ON storage.objects;
CREATE POLICY "grn_attachments_storage_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'grn-attachments');
