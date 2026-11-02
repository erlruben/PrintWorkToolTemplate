-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

-- ---------------------------------------------------------------
-- 6. Storage bucket for approved-file screenshots
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('previews', 'previews', false, 5242880,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists previews_read on storage.objects;
create policy previews_read on storage.objects
  for select to authenticated using (bucket_id = 'previews');

drop policy if exists previews_write on storage.objects;
create policy previews_write on storage.objects
  for insert to authenticated with check (bucket_id = 'previews');

drop policy if exists previews_update on storage.objects;
create policy previews_update on storage.objects
  for update to authenticated using (bucket_id = 'previews') with check (bucket_id = 'previews');
