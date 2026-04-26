-- Add photo_url column to labour_employees
ALTER TABLE public.labour_employees ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Create labour-photos storage bucket (public for read access)
INSERT INTO storage.buckets (id, name, public)
VALUES ('labour-photos', 'labour-photos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for labour-photos bucket
CREATE POLICY "Labour photos are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'labour-photos');

CREATE POLICY "Anyone can upload labour photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'labour-photos');

CREATE POLICY "Anyone can update labour photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'labour-photos');

CREATE POLICY "Anyone can delete labour photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'labour-photos');