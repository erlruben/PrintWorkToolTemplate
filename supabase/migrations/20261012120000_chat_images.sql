-- Pictures in chat, 2026-10-12.
--  * chat_messages.image_path: a message can carry one picture, stored in the
--    new private bucket "chat-images" under its conversation's folder.
--  * Only members of that conversation can open or add pictures in the
--    folder (two new storage policies, for this bucket only).
--
-- Additive only: one new nullable column, one new bucket, one small function
-- and two policies that apply to the new bucket alone. No existing row,
-- policy or bucket is changed.
alter table public.chat_messages add column if not exists image_path text;
-- A picture's path is "<its conversation's id>/<file name>": nothing else, and never another chat's folder.
alter table public.chat_messages drop constraint if exists chat_messages_image_path_chk;
alter table public.chat_messages add  constraint chat_messages_image_path_chk
  check (image_path is null
         or (image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'
             and split_part(image_path, '/', 1) = conversation_id::text));

-- The pictures themselves: a private bucket, 6 MB each, pictures only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 6291456,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Which conversation a stored picture belongs to: the first folder of its
-- path, when that is a conversation id (anything else belongs to none).
create or replace function public.chat_image_conversation(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
              then split_part(object_name, '/', 1)::uuid end
$$;
revoke execute on function public.chat_image_conversation(text) from public, anon;
grant  execute on function public.chat_image_conversation(text) to authenticated;

-- Only the members of a conversation can open or add the pictures in its
-- folder. Nobody changes or removes one by hand.
drop policy if exists chat_images_read on storage.objects;
create policy chat_images_read on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-images' and public.chat_is_member(public.chat_image_conversation(name)));
drop policy if exists chat_images_add on storage.objects;
create policy chat_images_add on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-images' and public.chat_is_member(public.chat_image_conversation(name)));
