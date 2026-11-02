-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

-- ---------------------------------------------------------------
-- 19. Chat Support tickets (migration 20261011023000_support_tickets)
--     Filed by the Help > Chat Support helper when a ticket is closed or
--     handed to Support. Kept 30 days, then deleted for good.
-- ---------------------------------------------------------------
create table if not exists public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  -- closed = the person said it was solved; handed_over = Support was added to a chat with them
  status          text not null default 'closed',
  transcript      jsonb not null default '[]'::jsonb,
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  started_at      timestamptz not null default now(),
  closed_at       timestamptz not null default now(),
  constraint support_tickets_status_chk check (status in ('closed', 'handed_over')),
  constraint support_tickets_transcript_chk
    check (jsonb_typeof(transcript) = 'array' and jsonb_array_length(transcript) <= 300 and pg_column_size(transcript) <= 200000)
);
create index if not exists support_tickets_user_idx   on public.support_tickets (user_id);
create index if not exists support_tickets_closed_idx on public.support_tickets (closed_at);
create index if not exists support_tickets_conversation_idx on public.support_tickets (conversation_id);

-- Support and the Tech Developer read every ticket; everyone else only their own.
create or replace function public.is_support_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.active and p.role::text in ('support', 'developer'))
$$;
revoke execute on function public.is_support_staff() from public, anon;
grant  execute on function public.is_support_staff() to authenticated;

alter table public.support_tickets enable row level security;
-- A ticket is readable for 30 days after it closed, then it is gone for everyone.
drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets
  for select to authenticated
  using (closed_at > now() - interval '30 days'
         and (user_id = (select auth.uid()) or (select public.is_support_staff())));
-- A person files their own ticket. Nobody edits or removes one by hand.
drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets
  for insert to authenticated
  with check (user_id = (select auth.uid()));
revoke all on public.support_tickets from anon, authenticated;
grant select, insert on public.support_tickets to authenticated;

-- Tickets older than 30 days are deleted for good, each time a new one is filed.
create or replace function public.support_tickets_purge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.support_tickets where closed_at < now() - interval '30 days';
  return null;
end $$;
revoke execute on function public.support_tickets_purge() from public, anon, authenticated;
drop trigger if exists support_tickets_purge_trg on public.support_tickets;
create trigger support_tickets_purge_trg
  after insert on public.support_tickets
  for each statement execute function public.support_tickets_purge();
