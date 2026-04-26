-- Drop existing storage policies for customer-logos bucket
DROP POLICY IF EXISTS "Customer logos are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload customer logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update customer logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete customer logos" ON storage.objects;

-- Create new permissive policies for customer-logos bucket
-- Since this app uses custom auth (app_users), we allow all operations on customer-logos bucket
CREATE POLICY "Anyone can view customer logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'customer-logos');

CREATE POLICY "Anyone can upload customer logos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'customer-logos');

CREATE POLICY "Anyone can update customer logos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'customer-logos');

CREATE POLICY "Anyone can delete customer logos"
ON storage.objects FOR DELETE
USING (bucket_id = 'customer-logos');