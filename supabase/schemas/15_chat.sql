-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

-- ---------------------------------------------------------------
-- 8. Chat — conversations (1:1 and groups), messages, reactions
--    Membership scoped: a conversation is private to its members.
--    See migration-027 for the one-time backfill of direct_messages.
-- ---------------------------------------------------------------
create table if not exists public.chat_conversations (
  id              uuid primary key default gen_random_uuid(),
  title           text,
  is_group        boolean not null default false,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  added_at        timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
-- A member's own marks on a chat (migration 20261011003000_chat_archive_delete):
-- archived_at = put away until a newer message; cleared_at = deleted on their
-- side (the app shows them nothing up to then; nobody else is affected).
alter table public.chat_members add column if not exists archived_at timestamptz;
alter table public.chat_members add column if not exists cleared_at  timestamptz;
create index if not exists chat_members_user_idx on public.chat_members(user_id);
create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null check (length(trim(body)) > 0),
  created_at      timestamptz not null default now()
);
create index if not exists chat_messages_conv_idx on public.chat_messages(conversation_id, created_at);
create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists chat_reactions_msg_idx on public.chat_reactions(message_id);
create index if not exists chat_conversations_created_by_idx on public.chat_conversations (created_by);
create index if not exists chat_messages_sender_id_idx on public.chat_messages (sender_id);
create index if not exists chat_reactions_user_id_idx on public.chat_reactions (user_id);

create or replace function public.chat_is_member(conv uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.chat_members where conversation_id = conv and user_id = auth.uid());
$$;
create or replace function public.chat_is_member_of_message(msg uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.chat_messages cm
    join public.chat_members mm on mm.conversation_id = cm.conversation_id
    where cm.id = msg and mm.user_id = auth.uid());
$$;
create or replace function public.chat_touch_conversation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.chat_conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists chat_touch_conversation_trg on public.chat_messages;
create trigger chat_touch_conversation_trg after insert on public.chat_messages
  for each row execute function public.chat_touch_conversation();
create or replace function public.chat_start(other uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); conv uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if other = me then raise exception 'Cannot start a chat with yourself'; end if;
  select c.id into conv from public.chat_conversations c
   where c.is_group = false
     and exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = me)
     and exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = other)
     and (select count(*) from public.chat_members m where m.conversation_id = c.id) = 2
   limit 1;
  if conv is null then
    insert into public.chat_conversations (is_group, created_by) values (false, me) returning id into conv;
    insert into public.chat_members (conversation_id, user_id) values (conv, me), (conv, other);
  end if;
  return conv;
end $$;
create or replace function public.chat_create_group(p_title text, member_ids uuid[])
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); conv uuid; uid uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  insert into public.chat_conversations (title, is_group, created_by)
    values (nullif(btrim(p_title), ''), true, me) returning id into conv;
  insert into public.chat_members (conversation_id, user_id) values (conv, me) on conflict do nothing;
  if member_ids is not null then
    foreach uid in array member_ids loop
      if uid is not null and uid <> me then
        insert into public.chat_members (conversation_id, user_id) values (conv, uid) on conflict do nothing;
      end if;
    end loop;
  end if;
  return conv;
end $$;
create or replace function public.chat_add_members(conv uuid, member_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid;
begin
  if not public.chat_is_member(conv) then raise exception 'Not a member of this chat'; end if;
  if member_ids is not null then
    foreach uid in array member_ids loop
      if uid is not null then
        insert into public.chat_members (conversation_id, user_id) values (conv, uid) on conflict do nothing;
      end if;
    end loop;
  end if;
end $$;

alter table public.chat_conversations enable row level security;
alter table public.chat_members       enable row level security;
alter table public.chat_messages      enable row level security;
alter table public.chat_reactions     enable row level security;
drop policy if exists chat_conv_read on public.chat_conversations;
create policy chat_conv_read on public.chat_conversations
  for select to authenticated using (public.chat_is_member(id) or created_by = (select auth.uid()));
drop policy if exists chat_conv_update on public.chat_conversations;
create policy chat_conv_update on public.chat_conversations
  for update to authenticated using (public.chat_is_member(id)) with check (public.chat_is_member(id));
drop policy if exists chat_members_read on public.chat_members;
create policy chat_members_read on public.chat_members
  for select to authenticated using (public.chat_is_member(conversation_id));
drop policy if exists chat_members_self on public.chat_members;
create policy chat_members_self on public.chat_members
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists chat_members_leave on public.chat_members;
create policy chat_members_leave on public.chat_members
  for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages
  for select to authenticated using (public.chat_is_member(conversation_id));
drop policy if exists chat_messages_send on public.chat_messages;
create policy chat_messages_send on public.chat_messages
  for insert to authenticated with check (sender_id = (select auth.uid()) and public.chat_is_member(conversation_id));
drop policy if exists chat_reactions_read on public.chat_reactions;
create policy chat_reactions_read on public.chat_reactions
  for select to authenticated using (public.chat_is_member_of_message(message_id));
drop policy if exists chat_reactions_add on public.chat_reactions;
create policy chat_reactions_add on public.chat_reactions
  for insert to authenticated with check (user_id = (select auth.uid()) and public.chat_is_member_of_message(message_id));
drop policy if exists chat_reactions_del on public.chat_reactions;
create policy chat_reactions_del on public.chat_reactions
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.chat_conversations to authenticated;
grant select, insert, update, delete on public.chat_members       to authenticated;
grant select, insert, update, delete on public.chat_messages      to authenticated;
grant select, insert, update, delete on public.chat_reactions     to authenticated;
grant execute on function public.chat_is_member(uuid)            to authenticated;
grant execute on function public.chat_is_member_of_message(uuid) to authenticated;
grant execute on function public.chat_start(uuid)                to authenticated;
grant execute on function public.chat_create_group(text, uuid[]) to authenticated;
grant execute on function public.chat_add_members(uuid, uuid[])  to authenticated;

-- Remove a person from a group (migration 030). Base RLS only lets someone
-- leave (delete their own row); removing another needs this security-definer
-- RPC. Any member may remove someone, mirroring chat_add_members.
create or replace function public.chat_remove_member(conv uuid, target uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.chat_is_member(conv) then raise exception 'Not a member of this chat'; end if;
  delete from public.chat_members where conversation_id = conv and user_id = target;
end $$;
grant execute on function public.chat_remove_member(uuid, uuid) to authenticated;

-- Delete a group chat (migration 044): only the person who made it, and only
-- once everyone else has been removed — so nobody loses a conversation they are
-- still in. Its messages and reactions go with it (cascade), and so do the
-- chat notices that pointed at it, so none of them opens a chat that is gone.
create or replace function public.chat_delete_group(conv uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  c  public.chat_conversations;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into c from public.chat_conversations where id = conv;
  if not found or not c.is_group then raise exception 'Group chat not found'; end if;
  if c.created_by is distinct from me then
    raise exception 'Only the person who made this group can delete it';
  end if;
  if exists (select 1 from public.chat_members m where m.conversation_id = conv and m.user_id <> me) then
    raise exception 'Remove everyone else from the group first';
  end if;
  delete from public.notifications where ref_id = conv and kind in ('message', 'mention');
  delete from public.chat_conversations where id = conv;
end $$;

-- Remove a chat nobody else can use any more (migration 044): everyone else in
-- it has a deleted or deactivated account — e.g. a one-to-one chat with someone
-- who left. Any member still in it may remove it; its messages and chat
-- notices go with it.
create or replace function public.chat_delete_orphan(conv uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.chat_is_member(conv) then raise exception 'Not a member of this chat'; end if;
  if exists (select 1 from public.chat_members m join public.profiles p on p.id = m.user_id
             where m.conversation_id = conv and m.user_id <> me and p.active) then
    raise exception 'Someone in this chat still has an active account';
  end if;
  delete from public.notifications where ref_id = conv and kind in ('message', 'mention');
  delete from public.chat_conversations where id = conv;
end $$;
do $$ begin alter publication supabase_realtime add table public.chat_conversations; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.chat_members;       exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.chat_messages;      exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.chat_reactions;     exception when duplicate_object then null; end $$;

-- Chat message notifications (bell) — one per other member. A member tagged
-- with @[Name](uuid) in the body gets the stronger 'mention' notice instead of
-- the ordinary 'message' one, so nobody is pinged twice (migration 029). The
-- strict uuid shape keeps the ::uuid cast from throwing on a typed lookalike.
create or replace function public.chat_notify()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sender_name text;
  conv_title  text;
  conv_group  boolean;
  mentioned   uuid[];
begin
  select full_name into sender_name from public.profiles where id = new.sender_id;
  select title, is_group into conv_title, conv_group from public.chat_conversations where id = new.conversation_id;

  select array_agg(distinct (x.arr)[1]::uuid) into mentioned
  from regexp_matches(
    new.body,
    '@\[[^\]]+\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)',
    'g'
  ) as x(arr);
  mentioned := coalesce(mentioned, '{}');

  -- Tagged members: "mentioned you".
  insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
  select m.user_id, 'mention',
    coalesce(sender_name, 'Someone') || ' mentioned you'
      || case when conv_group then ' in ' || coalesce(conv_title, 'a group chat') else '' end,
    new.body, new.conversation_id, new.sender_id
  from public.chat_members m
  where m.conversation_id = new.conversation_id
    and m.user_id <> new.sender_id
    and m.user_id = any(mentioned);

  -- Everyone else: "sent a message".
  insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
  select m.user_id, 'message',
    coalesce(sender_name, 'Someone')
      || case when conv_group then ' in ' || coalesce(conv_title, 'a group chat') else '' end
      || ' sent a message',
    new.body, new.conversation_id, new.sender_id
  from public.chat_members m
  where m.conversation_id = new.conversation_id
    and m.user_id <> new.sender_id
    and not (m.user_id = any(mentioned));

  return new;
end $$;
drop trigger if exists chat_notify_trg on public.chat_messages;
create trigger chat_notify_trg after insert on public.chat_messages
  for each row execute function public.chat_notify();

-- Per-work-order comment mentions (migration 029): @[Name](uuid) in a comment
-- notifies the tagged person, routed to that ticket. The thread has no other
-- notifications, so this is purely additive.
create or replace function public.notify_comment_mention()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  author_name text;
  wo          text;
  mentioned   uuid[];
begin
  select array_agg(distinct (x.arr)[1]::uuid) into mentioned
  from regexp_matches(
    new.body,
    '@\[[^\]]+\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)',
    'g'
  ) as x(arr);
  if mentioned is null then return new; end if;

  select full_name into author_name from public.profiles where id = new.author_id;
  select wo_number into wo from public.work_orders where id = new.work_order_id;

  insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
  select distinct uid, 'comment',
    coalesce(author_name, 'Someone') || ' mentioned you on ' || coalesce(wo, 'a work order'),
    new.body, new.work_order_id, new.author_id
  from unnest(mentioned) as uid
  where uid <> new.author_id;

  return new;
end $$;
drop trigger if exists notify_comment_mention_trg on public.messages;
create trigger notify_comment_mention_trg after insert on public.messages
  for each row execute function public.notify_comment_mention();

-- Pictures in chat (migration 20261012120000_chat_images): a message can carry
-- one picture, stored in the private bucket "chat-images" under its
-- conversation's folder; only that conversation's members can open or add them.
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
