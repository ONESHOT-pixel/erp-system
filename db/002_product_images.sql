-- 002_product_images.sql
--
-- إضافة صورة لكل مادة حتى يتعرف عليها الكاشير بصرياً بدل قراءة الاسم.
--
-- شغّل هذا الملف من: Supabase ← SQL Editor ← New query ← الصق ← Run

begin;

-- ---------------------------------------------------------------
-- 1) عمود رابط الصورة
-- ---------------------------------------------------------------
alter table public.products
  add column if not exists image_url text;

-- ---------------------------------------------------------------
-- 2) مخزن الصور
--    public = true حتى تظهر الصور في الواجهة بلا توقيع لكل طلب.
--    الصور ليست بيانات حساسة، بعكس جداول المبيعات والزبائن.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- 3) صلاحيات المخزن
--    القراءة للجميع (لعرض الصور)، والرفع والحذف للمسجَّلين فقط.
-- ---------------------------------------------------------------
drop policy if exists product_images_read   on storage.objects;
drop policy if exists product_images_insert on storage.objects;
drop policy if exists product_images_update on storage.objects;
drop policy if exists product_images_delete on storage.objects;

create policy product_images_read on storage.objects
  for select to public
  using (bucket_id = 'product-images');

create policy product_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images');

create policy product_images_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images')
  with check (bucket_id = 'product-images');

create policy product_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images');

commit;
