-- Password recovery email, 2026-10-11: a person may add or change their OWN
-- recovery email in Settings, after typing their current password. Admins can
-- still add, change and remove anyone's; only an admin can remove one.
--
-- Additive only: one small new table and one new function. No policy changes,
-- no data changed or removed.
-- 4. A person may ADD or CHANGE their own recovery email (2026-10-11) after
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
