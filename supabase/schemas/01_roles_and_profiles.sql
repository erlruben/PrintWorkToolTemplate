-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

-- ---------------------------------------------------------------
-- 1. Roles and profiles
-- ---------------------------------------------------------------
do $$ begin
  create type app_role as enum ('admin', 'receptionist', 'artist', 'operator');
exception when duplicate_object then null; end $$;
-- Tech Developer and Support (migration 049): full access, the same as admin.
alter type app_role add value if not exists 'developer';
alter type app_role add value if not exists 'support';
-- Moderator has reception-level workflow access; Admin remains the highest role.
alter type app_role add value if not exists 'moderator';

-- PRD §8: operators work at one of two printing areas.
do $$ begin
  create type work_site as enum ('office', 'production');
exception when duplicate_object then null; end $$;

-- How pressing a job is; null means unset.
do $$ begin
  create type urgency as enum ('low', 'mid', 'high', 'urgent');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  full_name            text not null,
  role                 app_role not null default 'artist',
  active               boolean not null default true,
  site                 work_site,          -- operators only; null otherwise
  must_change_password boolean not null default true,
  created_at           timestamptz not null default now()
);

-- Staff status, Slack-style (migration 20261008120000_staff_status): Working,
-- Out of office or Sick, an optional note, and an optional time it clears
-- itself (the app reads a passed status_until as Working).
alter table public.profiles add column if not exists status       text not null default 'working';
alter table public.profiles add column if not exists status_note  text;
alter table public.profiles add column if not exists status_until timestamptz;
alter table public.profiles drop constraint if exists profiles_status_chk;
alter table public.profiles add  constraint profiles_status_chk
  check (status in ('working', 'out_of_office', 'sick')
         and char_length(coalesce(status_note, '')) <= 80);

-- Read the caller's role without tripping RLS recursion. Tech Developer and
-- Support (049) have full access; Moderators get the reception-level workflow
-- permissions while admin-only account and app settings stay restricted.
create or replace function public.current_user_role()
returns app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when role::text in ('developer', 'support') then 'admin'::app_role
    when role::text = 'moderator' then 'receptionist'::app_role
    else role
  end
  from public.profiles where id = auth.uid()
$$;

-- Every new auth user gets a profile. Lets the admin fall back to
-- creating people straight from the Supabase dashboard if needed.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, role, must_change_password, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'artist'),
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, true),
    -- Staff sign in with a username, stored as username@printflow.local; expose the
    -- username here. Owners with a real email have no username.
    case when new.email ilike '%@printflow.local' then split_part(new.email, '@', 1) else null end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
