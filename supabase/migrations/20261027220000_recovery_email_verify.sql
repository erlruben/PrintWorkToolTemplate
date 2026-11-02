-- Confirm a recovery email with a code, 2026-10-27 ("do we have
-- validation if email is real?"). Until now a recovery email was only checked
-- for its shape (and, in the app, its domain). This lets a person prove the
-- mailbox is theirs: a 6-digit code is emailed to it and typed back.
--
--  * account_recovery.verified_at: when the CURRENT email was confirmed. A new
--    or changed email starts unconfirmed; only the database itself (the code
--    check below, or the server) can set it.
--  * recovery_email_codes: the code sent, kept only as a hash, for 15 minutes,
--    with a count of wrong tries. Written by the `recovery-verify` Edge Function
--    (service role); nobody else can read or write it.
--  * confirm_recovery_email(code): the signed-in person types the code; 5 wrong
--    tries end that code.
--
-- Switched off until the Gmail sending is set up: the app only offers "Send
-- code" when the recovery-verify function answers that it can send email.
-- Additive only: one new nullable column, one new table, two functions, a trigger.

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
