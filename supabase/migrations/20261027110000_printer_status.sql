-- Printer status per printing area, 2026-10-27 ("Printer Broken
-- Notification ... Print Queue status to see upper right (Cooldown and Broken
-- Printer Notification)").
--
--  * printer_status: one row per area (Office, Production) — Working, Cooling
--    down (until a time), or Broken (with a note). Everyone signed in reads it;
--    nobody writes it directly.
--  * set_printer_status(): operators, reception, admins (and the developer /
--    support accounts) change it. Marking a printer Broken, and later marking
--    it fixed, notifies EVERY active staff account except the person who did it
--    (chosen workflow). A cool-down notifies nobody: it shows on the Print Queue
--    and on the tasks going to that area, and ends by itself when its time is up
--    (a cool-down whose time has passed reads as Working).
--  * New notification kind 'printer'.
--
-- Additive only: one new table with two rows, one function, a wider kind check.

create table if not exists public.printer_status (
  site            public.work_site primary key,
  state           text not null default 'working' check (state in ('working', 'cooldown', 'broken')),
  note            text check (char_length(coalesce(note, '')) <= 500),
  until           timestamptz,
  changed_at      timestamptz not null default now(),
  -- Who changed it, by id and by name as it was (the name outlives the account).
  changed_by      uuid,
  changed_by_name text
);
insert into public.printer_status (site) values ('office'), ('production') on conflict (site) do nothing;

alter table public.printer_status enable row level security;
drop policy if exists printer_status_read on public.printer_status;
create policy printer_status_read on public.printer_status
  for select to authenticated using (true);
revoke all on public.printer_status from anon, authenticated;
grant select on public.printer_status to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.printer_status;
exception when duplicate_object then null; end $$;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add  constraint notifications_kind_check
  check (kind in ('assign', 'message', 'mention', 'comment', 'printed', 'finished', 'queued', 'problem',
                  'materials', 'materials_released', 'low_stock',
                  'period_ready', 'period_closed',
                  -- a printing area's printer broken / fixed (20261027110000_printer_status)
                  'printer'));

create or replace function public.set_printer_status(
  p_site    public.work_site,
  p_state   text,
  p_seconds integer default null,
  p_note    text default null
) returns public.printer_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  caller  text := (select public.current_user_role())::text;
  me_name text;
  cur     public.printer_status;
  was     text;
  area    text := case p_site when 'office' then 'Office' else 'Production' end;
  msg     text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if me is null or caller is null or caller not in ('operator', 'receptionist', 'admin', 'developer', 'support') then
    raise exception 'Only printer operators, reception and admins can change a printer''s status';
  end if;
  if p_state is null or p_state not in ('working', 'cooldown', 'broken') then
    raise exception 'Choose Working, Cooling down or Broken';
  end if;
  if p_state = 'cooldown' and (p_seconds is null or p_seconds < 1 or p_seconds > 86400) then
    raise exception 'Set how long the printer cools down (up to 24 hours)';
  end if;
  if char_length(coalesce(msg, '')) > 500 then
    raise exception 'Keep the note under 500 characters';
  end if;

  select full_name into me_name from public.profiles where id = me;
  select * into cur from public.printer_status where site = p_site for update;
  if not found then
    insert into public.printer_status (site) values (p_site) returning * into cur;
  end if;
  -- A cool-down whose time is up was already back to Working.
  was := case when cur.state = 'cooldown' and (cur.until is null or cur.until <= now()) then 'working' else cur.state end;

  update public.printer_status
     set state = p_state,
         note = case when p_state = 'working' then null else msg end,
         until = case when p_state = 'cooldown' then now() + make_interval(secs => p_seconds) end,
         changed_at = now(),
         changed_by = me,
         changed_by_name = me_name
   where site = p_site
  returning * into cur;

  -- Broken, and fixed again: everyone hears about it (not the person who said so).
  if p_state = 'broken' and was is distinct from 'broken' then
    insert into public.notifications (user_id, kind, title, body, actor_id)
    select p.id, 'printer', area || ' printer is broken',
           coalesce(msg || ' — ', '') || 'marked by ' || coalesce(me_name, 'someone') || '. Jobs for ' || area || ' may be late.',
           me
      from public.profiles p
     where p.active and p.id <> me;
  elsif was = 'broken' and p_state <> 'broken' then
    insert into public.notifications (user_id, kind, title, body, actor_id)
    select p.id, 'printer', area || ' printer is working again',
           case when p_state = 'cooldown' then 'Cooling down first. ' else '' end || 'Marked by ' || coalesce(me_name, 'someone') || '.',
           me
      from public.profiles p
     where p.active and p.id <> me;
  end if;
  return cur;
end $$;
revoke execute on function public.set_printer_status(public.work_site, text, integer, text) from public, anon;
grant execute on function public.set_printer_status(public.work_site, text, integer, text) to authenticated;
