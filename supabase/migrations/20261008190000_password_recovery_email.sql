-- Forgot password by email. Staff sign in with a username (stored as a hidden
-- username@printflow.local address), so each person also has a private RECOVERY
-- email, added by an admin (Admin / Tech Developer / Support) in Accounts.
-- The public Edge Function `password-reset` looks it up and emails a one-time
-- reset link.
--
-- Additive only: two new tables and one lookup function; no existing data changes.

-- 1. The recovery email: added and changed by admins only (for security); a
--    person can see their own. Other staff never see it.
create table if not exists public.account_recovery (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  email      text not null,
  updated_at timestamptz not null default now(),
  constraint account_recovery_email_chk
    check (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
alter table public.account_recovery enable row level security;

drop policy if exists account_recovery_select on public.account_recovery;
create policy account_recovery_select on public.account_recovery
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.current_user_role()) = 'admin');
drop policy if exists account_recovery_insert on public.account_recovery;
create policy account_recovery_insert on public.account_recovery
  for insert to authenticated
  with check ((select public.current_user_role()) = 'admin');
drop policy if exists account_recovery_update on public.account_recovery;
create policy account_recovery_update on public.account_recovery
  for update to authenticated
  using ((select public.current_user_role()) = 'admin')
  with check ((select public.current_user_role()) = 'admin');
drop policy if exists account_recovery_delete on public.account_recovery;
create policy account_recovery_delete on public.account_recovery
  for delete to authenticated
  using ((select public.current_user_role()) = 'admin');

revoke all on public.account_recovery from anon;
grant select, insert, update, delete on public.account_recovery to authenticated;

create or replace function public.account_recovery_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.account_recovery_touch() from public, anon, authenticated;

drop trigger if exists account_recovery_touch_trg on public.account_recovery;
create trigger account_recovery_touch_trg
  before insert or update on public.account_recovery
  for each row execute function public.account_recovery_touch();

-- 2. Reset requests, for a limit of a few per hour per account. Only the Edge
--    Function (service role) reads or writes it — RLS on with no policies.
create table if not exists public.password_reset_requests (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now()
);
create index if not exists password_reset_requests_user_idx
  on public.password_reset_requests (user_id, requested_at desc);
alter table public.password_reset_requests enable row level security;
revoke all on public.password_reset_requests from anon, authenticated;

-- 3. Login email → account id, for the Edge Function only (auth.users is not
--    reachable through the API). Not callable by signed-in or signed-out users.
create or replace function public.user_id_for_login_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1
$$;
revoke execute on function public.user_id_for_login_email(text) from public, anon, authenticated;
grant execute on function public.user_id_for_login_email(text) to service_role;
