-- Staff status, Slack-style: Working (the default), Out of office or Sick, with
-- an optional short note ("Back Monday") and an optional time it clears itself.
-- People set their own (profiles_self_update already allows it; profiles_guard
-- only protects role and active); admins can set anyone's. The app treats a
-- status whose time has passed as Working, so nothing has to clear it.
--
-- Additive only: three new columns with a default, no existing data changes.

alter table public.profiles add column if not exists status       text not null default 'working';
alter table public.profiles add column if not exists status_note  text;
alter table public.profiles add column if not exists status_until timestamptz;

alter table public.profiles drop constraint if exists profiles_status_chk;
alter table public.profiles add  constraint profiles_status_chk
  check (status in ('working', 'out_of_office', 'sick')
         and char_length(coalesce(status_note, '')) <= 80);

-- Everyone sees a status change straight away (every profile column is already
-- readable by every signed-in person through profiles_read).
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
