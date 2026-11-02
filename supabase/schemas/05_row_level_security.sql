-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

-- ---------------------------------------------------------------
-- 5. Row level security
--    Small trusted shop: everyone signed in reads everything.
--    Writing is what gets scoped.
-- ---------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.work_orders   enable row level security;
alter table public.messages      enable row level security;
alter table public.message_reads enable row level security;

-- Profiles
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.current_user_role()) = 'admin')
  with check (id = (select auth.uid()) or (select public.current_user_role()) = 'admin');

-- A person may keep their own profile (their name, the must-change-password
-- flag), but must never change their own ROLE or ACTIVE flag — that would be
-- self-promotion to admin. RLS WITH CHECK cannot compare against the old row,
-- so this is enforced in a trigger. The service_role (the admin-users Edge
-- Function) has no auth.uid() and is trusted, so it is not restricted.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and public.current_user_role() is distinct from 'admin' then
    if new.role is distinct from old.role then
      raise exception 'You cannot change your own role';
    end if;
    if new.active is distinct from old.active then
      raise exception 'You cannot change your own active status';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- Deactivation is a countdown: stamp when someone is switched off, clear it
-- when they are switched back on. A stamped account is purged 3 days later.
create or replace function public.stamp_deactivated()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.active is distinct from old.active then
    new.deactivated_at := case when new.active then null else now() end;
  end if;
  return new;
end $$;

drop trigger if exists stamp_deactivated_trg on public.profiles;
create trigger stamp_deactivated_trg
  before update of active on public.profiles
  for each row execute function public.stamp_deactivated();

-- Permanently remove accounts that have been deactivated for more than 3 days.
-- Deleting the auth user cascades to the profile; work orders keep their rows
-- (the artist link just goes null). Runs from a daily pg_cron job (below); can
-- also be called by hand. security definer so it can reach auth.users.
create or replace function public.purge_deactivated_accounts()
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  removed integer;
begin
  with gone as (
    delete from auth.users u
    using public.profiles p
    where p.id = u.id
      and p.active = false
      and p.deactivated_at is not null
      and p.deactivated_at < now() - interval '3 days'
    returning u.id
  )
  select count(*) into removed from gone;
  return removed;
end $$;

-- Schedule the purge once a day (03:10 UTC). pg_cron lives in this database on
-- Supabase; the guarded block keeps the schema safe to re-run.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule('purge-deactivated')
      where exists (select 1 from cron.job where jobname = 'purge-deactivated');
    perform cron.schedule('purge-deactivated', '10 3 * * *',
      $cron$ select public.purge_deactivated_accounts(); $cron$);
  end if;
exception when others then
  -- pg_cron may be unavailable locally; the app works without the auto-purge.
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;

-- Work orders
drop policy if exists work_orders_read on public.work_orders;
create policy work_orders_read on public.work_orders
  for select to authenticated using (true);

-- Reception/admin open jobs for anyone; an artist can also open a task, but
-- only one assigned to themselves (they then drive it through To Do / In
-- progress — the same rows their update policy already lets them edit).
drop policy if exists work_orders_insert on public.work_orders;
create policy work_orders_insert on public.work_orders
  for insert to authenticated
  with check (
    (select public.current_user_role()) in ('receptionist', 'admin')
    or ((select public.current_user_role()) = 'artist' and artist_id = (select auth.uid()))
  );

-- Artists edit their own jobs; reception/admin edit any; operators need
-- update rights for the printed check-off (the trigger above is what stops
-- an artist from using this to tick printed).
drop policy if exists work_orders_update on public.work_orders;
create policy work_orders_update on public.work_orders
  for update to authenticated
  using (
    (select public.current_user_role()) in ('receptionist', 'admin', 'operator')
    or artist_id = (select auth.uid())
  )
  with check (
    (select public.current_user_role()) in ('receptionist', 'admin', 'operator')
    or artist_id = (select auth.uid())
  );

drop policy if exists work_orders_delete on public.work_orders;
create policy work_orders_delete on public.work_orders
  for delete to authenticated using ((select public.current_user_role()) = 'admin');

-- Chat
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages
  for select to authenticated using (true);

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated with check (author_id = (select auth.uid()));

-- Messages are part of the audit trail — nobody edits history.
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated using ((select public.current_user_role()) = 'admin');

-- Read receipts are private to each person
drop policy if exists reads_own on public.message_reads;
create policy reads_own on public.message_reads
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
