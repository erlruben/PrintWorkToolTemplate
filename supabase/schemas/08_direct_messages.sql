-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

-- ---------------------------------------------------------------
-- 6d. Direct messages — one-to-one chat, the "Chats" tab. Separate from the
--     per-work-order Comments; reached from a floating tab, tied to no job.
-- ---------------------------------------------------------------
create table if not exists public.direct_messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (length(trim(body)) > 0),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check (sender_id <> recipient_id)
);
create index if not exists dm_sender_idx    on public.direct_messages(sender_id, created_at);
create index if not exists dm_recipient_idx on public.direct_messages(recipient_id, created_at);

alter table public.direct_messages enable row level security;
drop policy if exists dm_read on public.direct_messages;
create policy dm_read on public.direct_messages
  for select to authenticated
  using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));
drop policy if exists dm_insert on public.direct_messages;
create policy dm_insert on public.direct_messages
  for insert to authenticated with check (sender_id = (select auth.uid()));
drop policy if exists dm_mark_read on public.direct_messages;
create policy dm_mark_read on public.direct_messages
  for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
drop policy if exists dm_delete on public.direct_messages;
create policy dm_delete on public.direct_messages
  for delete to authenticated
  using (sender_id = (select auth.uid()) or (select public.current_user_role()) = 'admin');
grant select, insert, update, delete on public.direct_messages to authenticated;
