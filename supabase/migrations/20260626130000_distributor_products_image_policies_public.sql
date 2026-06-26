-- The app uploads with the anon key (custom auth layer), so the distributor
-- product image storage policies must target the public role, the same as the
-- existing grn-attachments bucket. The original `authenticated`-scoped policies
-- caused "new row violates row-level security policy" on upload.
drop policy if exists "distributor_products_images_public_read" on storage.objects;
drop policy if exists "distributor_products_images_auth_insert" on storage.objects;
drop policy if exists "distributor_products_images_auth_update" on storage.objects;
drop policy if exists "distributor_products_images_auth_delete" on storage.objects;

create policy "distributor_products_images_read"
  on storage.objects for select to public
  using (bucket_id = 'distributor-products');

create policy "distributor_products_images_insert"
  on storage.objects for insert to public
  with check (bucket_id = 'distributor-products');

create policy "distributor_products_images_update"
  on storage.objects for update to public
  using (bucket_id = 'distributor-products');

create policy "distributor_products_images_delete"
  on storage.objects for delete to public
  using (bucket_id = 'distributor-products');
