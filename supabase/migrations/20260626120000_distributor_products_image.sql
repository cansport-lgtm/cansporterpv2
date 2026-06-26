-- Add a product picture to distributor products and a public bucket to store it.
alter table public.distributor_products
  add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('distributor-products', 'distributor-products', true)
on conflict (id) do nothing;

-- Public read; authenticated users may manage product images.
drop policy if exists "distributor_products_images_public_read" on storage.objects;
create policy "distributor_products_images_public_read"
  on storage.objects for select
  using (bucket_id = 'distributor-products');

drop policy if exists "distributor_products_images_auth_insert" on storage.objects;
create policy "distributor_products_images_auth_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'distributor-products');

drop policy if exists "distributor_products_images_auth_update" on storage.objects;
create policy "distributor_products_images_auth_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'distributor-products');

drop policy if exists "distributor_products_images_auth_delete" on storage.objects;
create policy "distributor_products_images_auth_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'distributor-products');
