-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

-- ---------------------------------------------------------------
-- 17. Password recovery email (migration 20261008190000_password_recovery_email)
-- ---------------------------------------------------------------
-- 1. The recovery email. Support and the Tech Developer can add, change and
--    remove anyone's (the Admin role cannot, since 2026-10-12); a person
--    can see their own, and add or change it with their password (see 4).
--    Other staff never see it.
create table if not exists public.account_recovery (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  email      text not null,
  updated_at timestamptz not null default now(),
  constraint account_recovery_email_chk
    check (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
alter table public.account_recovery enable row level security;

-- Since migration 20261012210000_recovery_email_support_only: other people's are
-- managed by Support and the Tech Developer only (not the Admin role).
drop policy if exists account_recovery_select on public.account_recovery;
create policy account_recovery_select on public.account_recovery
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_support_staff()));
drop policy if exists account_recovery_insert on public.account_recovery;
create policy account_recovery_insert on public.account_recovery
  for insert to authenticated
  with check ((select public.is_support_staff()));
drop policy if exists account_recovery_update on public.account_recovery;
create policy account_recovery_update on public.account_recovery
  for update to authenticated
  using ((select public.is_support_staff()))
  with check ((select public.is_support_staff()));
drop policy if exists account_recovery_delete on public.account_recovery;
create policy account_recovery_delete on public.account_recovery
  for delete to authenticated
  using ((select public.is_support_staff()));

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

-- 4. (migration 20261011013000_set_own_recovery_email) A person may ADD or CHANGE their own recovery email (2026-10-11) after
--    typing their current password, so a phone left unlocked is not enough to
--    take the account over. Removing one stays with the admins (who can also
--    still add or change anyone's). Five wrong passwords lock it for 15
--    minutes. Returns a word, never raises for a wrong password (a raise would
--    undo the count):
--      ok | not_signed_in | bad_email | wrong_password | locked
--    The wrong tries are counted per person in their own small table, which
--    only this function touches (RLS on, no policies).
create table if not exists public.recovery_email_attempts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  fails   integer not null default 0,
  fail_at timestamptz
);
alter table public.recovery_email_attempts enable row level security;
revoke all on public.recovery_email_attempts from anon, authenticated;

create or replace function public.set_my_recovery_email(p_email text, p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me    uuid := auth.uid();
  att   public.recovery_email_attempts;
  hash  text;
  addr  text := lower(btrim(coalesce(p_email, '')));
begin
  if me is null then return 'not_signed_in'; end if;
  if not exists (select 1 from public.profiles p where p.id = me and p.active) then return 'not_signed_in'; end if;
  if char_length(addr) > 254 or addr !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return 'bad_email'; end if;

  insert into public.recovery_email_attempts (user_id) values (me) on conflict (user_id) do nothing;
  select * into att from public.recovery_email_attempts where user_id = me for update;
  if att.fails >= 5 and att.fail_at > now() - interval '15 minutes' then return 'locked'; end if;

  select u.encrypted_password into hash from auth.users u where u.id = me;
  if hash is null or coalesce(p_password, '') = '' or hash <> extensions.crypt(p_password, hash) then
    update public.recovery_email_attempts
       set fails = case when fail_at > now() - interval '15 minutes' then fails + 1 else 1 end,
           fail_at = now()
     where user_id = me;
    return 'wrong_password';
  end if;

  insert into public.account_recovery (user_id, email) values (me, addr)
    on conflict (user_id) do update set email = excluded.email;
  update public.recovery_email_attempts set fails = 0, fail_at = null where user_id = me;
  return 'ok';
end $$;
revoke execute on function public.set_my_recovery_email(text, text) from public, anon;
grant  execute on function public.set_my_recovery_email(text, text) to authenticated;

-- ---------------------------------------------------------------
-- 5. Confirm the recovery email with a code (migration 20261027220000_recovery_email_verify)
--    A 6-digit code is emailed by the recovery-verify Edge Function and typed
--    back through confirm_recovery_email(); verified_at is set only then, and a
--    new or changed email starts unconfirmed. Codes are kept as a hash only.
-- ---------------------------------------------------------------
alter table public.account_recovery add column if not exists verified_at timestamptz;

-- A new or changed email is not confirmed; nobody but the database sets it.
create or replace function public.account_recovery_verified_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.email is distinct from old.email then
    new.verified_at := null;
  elsif new.verified_at is distinct from old.verified_at
        and coalesce(current_setting('printflow.confirming_recovery', true), '') <> 'on'
        and coalesce(auth.role(), '') <> 'service_role' then
    new.verified_at := old.verified_at;
  end if;
  return new;
end $$;
revoke execute on function public.account_recovery_verified_guard() from public, anon, authenticated;

drop trigger if exists account_recovery_verified_trg on public.account_recovery;
create trigger account_recovery_verified_trg
  before insert or update on public.account_recovery
  for each row execute function public.account_recovery_verified_guard();

create table if not exists public.recovery_email_codes (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  email      text not null,
  -- sha-256 (hex) of the code followed by the user id — never the code itself.
  code_hash  text not null check (char_length(code_hash) = 64),
  sent_at    timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts   integer not null default 0
);
alter table public.recovery_email_codes enable row level security;
revoke all on public.recovery_email_codes from anon, authenticated;

-- The person types the code back. Answers: 'ok', 'no_code', 'expired',
-- 'locked', 'wrong_code', 'changed' (the email was changed since the code was sent).
create or replace function public.confirm_recovery_email(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me   uuid := auth.uid();
  c    public.recovery_email_codes;
  cur  text;
  code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
begin
  if me is null then return 'not_signed_in'; end if;
  select * into c from public.recovery_email_codes where user_id = me for update;
  if not found then return 'no_code'; end if;
  if c.expires_at <= now() then return 'expired'; end if;
  if c.attempts >= 5 then return 'locked'; end if;
  select email into cur from public.account_recovery where user_id = me;
  if cur is distinct from c.email then
    delete from public.recovery_email_codes where user_id = me;
    return 'changed';
  end if;
  if char_length(code) <> 6
     or encode(extensions.digest(code || me::text, 'sha256'), 'hex') <> c.code_hash then
    update public.recovery_email_codes set attempts = attempts + 1 where user_id = me;
    return 'wrong_code';
  end if;
  perform set_config('printflow.confirming_recovery', 'on', true);
  update public.account_recovery set verified_at = now() where user_id = me and email = c.email;
  perform set_config('printflow.confirming_recovery', 'off', true);
  delete from public.recovery_email_codes where user_id = me;
  return 'ok';
end $$;
revoke execute on function public.confirm_recovery_email(text) from public, anon;
grant  execute on function public.confirm_recovery_email(text) to authenticated;
