-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

-- ---------------------------------------------------------------
-- 22. Artist file-credits + the Monthly/Quarterly/Yearly report archive
--     (migrations 20261021100000_file_approval_and_artist_credits,
--     20261022120000_report_periods)
-- ---------------------------------------------------------------
-- Separate from app/src/lib/credits.ts (which credits makers and printers
-- from work_order_events). "Art done" everywhere in the app — the Workload
-- table and every report tab — is simply a count of file_credit_events in
-- the period: one row per file an ARTIST adds to any task (a receptionist's
-- or admin's add never counts), removed again by revoke_file_credit when the
-- file comes off the task. There is no separate "current count" to keep in
-- sync — it's always just a date-filtered query over this table.

create table if not exists public.file_credit_events (
  id            uuid primary key default gen_random_uuid(),
  -- The task, and its number as it was — the row outlives a task removed for good.
  work_order_id uuid references public.work_orders(id) on delete set null,
  wo_number     text,
  file_url      text not null check (char_length(file_url) <= 2048),
  artist_id     uuid references public.profiles(id) on delete set null,
  artist_name   text,
  at            timestamptz not null default now()
);
create index if not exists file_credit_events_artist_idx on public.file_credit_events (artist_id, at);
create index if not exists file_credit_events_order_idx  on public.file_credit_events (work_order_id);

alter table public.file_credit_events enable row level security;
drop policy if exists file_credit_events_read on public.file_credit_events;
create policy file_credit_events_read on public.file_credit_events
  for select to authenticated using (true);
revoke all on public.file_credit_events from anon, authenticated;
grant select on public.file_credit_events to authenticated;

-- Logs 1 credit for the file — only when the caller is an artist; a silent
-- no-op otherwise, so a receptionist's upload never earns a point even if the
-- client calls this for every add.
create or replace function public.log_file_credit(p_work_order uuid, p_file_url text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me      uuid := auth.uid();
  me_role app_role;
  me_name text;
  wo_no   text;
begin
  if me is null then return; end if;
  select role, full_name into me_role, me_name from public.profiles where id = me;
  if me_role is distinct from 'artist' then return; end if;
  select wo_number into wo_no from public.work_orders where id = p_work_order;
  if not found then return; end if;
  insert into public.file_credit_events (work_order_id, wo_number, file_url, artist_id, artist_name)
  values (p_work_order, wo_no, left(p_file_url, 2048), me, me_name);
end $$;
revoke execute on function public.log_file_credit(uuid, text) from public, anon;
grant execute on function public.log_file_credit(uuid, text) to authenticated;

-- Takes back whatever credit a file earned when it's removed from a task,
-- regardless of who removes it. A silent no-op if no such credit exists.
create or replace function public.revoke_file_credit(p_work_order uuid, p_file_url text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.file_credit_events
   where work_order_id = p_work_order and file_url = left(p_file_url, 2048);
end $$;
revoke execute on function public.revoke_file_credit(uuid, text) from public, anon;
grant execute on function public.revoke_file_credit(uuid, text) to authenticated;

-- The same, done by the database in the save that takes the file off the task
-- (migration 20261022200000_drop_removed_file_credits), so a dropped
-- connection after the save can't leave the credit behind.
create or replace function public.drop_removed_file_credits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $
begin
  delete from public.file_credit_events e
   where e.work_order_id = new.id
     and e.file_url is distinct from left(coalesce(new.file_link, ''), 2048)
     and not exists (
       select 1 from jsonb_array_elements(coalesce(new.attachments, '[]'::jsonb)) a
        where left(a->>'url', 2048) = e.file_url);
  return null;
end $;
revoke execute on function public.drop_removed_file_credits() from public, anon, authenticated;

drop trigger if exists drop_removed_file_credits_trg on public.work_orders;
create trigger drop_removed_file_credits_trg
  after update of attachments, file_link on public.work_orders
  for each row
  when (old.attachments is distinct from new.attachments or old.file_link is distinct from new.file_link)
  execute function public.drop_removed_file_credits();

-- ---------------------------------------------------------------
-- The report archive — a frozen snapshot per month/quarter/year, admin-only
-- ---------------------------------------------------------------
-- The live, un-archived view for "this period so far" is always a
-- date-filtered query over work_order_events + file_credit_events (same
-- credits() call the UI already makes) — nothing here needs to be zeroed
-- when a new period starts. Once a period ends, the first admin to open its
-- report tab computes that snapshot client-side and hands it to
-- open_report_period — the one write path, so the number shown live and the
-- number archived can never disagree. A still-pending period auto-finalizes
-- 2 days after it was opened if nobody closes it by hand.
create table if not exists public.report_periods (
  id            uuid primary key default gen_random_uuid(),
  period_type   text not null check (period_type in ('month', 'quarter', 'year')),
  period_label  text not null,                   -- '2026-10' | '2026-Q4' | '2026'
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'pending' check (status in ('pending', 'finalized')),
  pending_since timestamptz not null default now(),
  finalized_at  timestamptz,
  finalized_by  uuid references public.profiles(id) on delete set null,  -- null = closed automatically
  -- { opened, artDone, printed, makers: [{id,name,count}], artists: [{id,name,given,count}], printers: [{id,name,count}] }
  snapshot      jsonb not null default '{}'::jsonb,
  drive_link     text,
  drive_saved_at timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (period_type, period_label)
);
create index if not exists report_periods_type_idx on public.report_periods (period_type, period_label);

alter table public.report_periods enable row level security;
drop policy if exists report_periods_read on public.report_periods;
create policy report_periods_read on public.report_periods
  for select to authenticated using ((select public.current_user_role()) = 'admin');
revoke all on public.report_periods from anon, authenticated;
grant select on public.report_periods to authenticated;

create or replace function public.open_report_period(
  p_period_type  text,
  p_period_label text,
  p_period_start date,
  p_period_end   date,
  p_snapshot     jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if (select public.current_user_role()) is distinct from 'admin' then
    raise exception 'Only an admin can open a report period';
  end if;

  insert into public.report_periods
    (period_type, period_label, period_start, period_end, status, pending_since, snapshot, created_by)
  values (p_period_type, p_period_label, p_period_start, p_period_end, 'pending', now(), p_snapshot, me)
  on conflict (period_type, period_label) do nothing;

  if found then
    insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
    select p.id, 'period_ready',
      p_period_label || ' report is ready to close',
      'Review it under Report — it closes on its own in 2 days if nobody acts.',
      null, me
    from public.profiles p
    where p.role = 'admin' and p.active;
  end if;
end $$;
revoke execute on function public.open_report_period(text, text, date, date, jsonb) from public, anon;
grant execute on function public.open_report_period(text, text, date, date, jsonb) to authenticated;

-- An admin closing a still-pending period early. The automatic 2-day close
-- (process_report_periods, below) does the same update directly — this is
-- only the human-triggered path, so finalized_by records the real admin.
create or replace function public.finalize_report_period(p_period_type text, p_period_label text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if (select public.current_user_role()) is distinct from 'admin' then
    raise exception 'Only an admin can close a report period';
  end if;
  update public.report_periods
     set status = 'finalized', finalized_at = now(), finalized_by = me
   where period_type = p_period_type and period_label = p_period_label and status = 'pending';
  if not found then
    raise exception 'No pending % report % to close', p_period_type, p_period_label;
  end if;
  insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
  select p.id, 'period_closed',
    coalesce((select full_name from public.profiles where id = me), 'An admin')
      || ' closed the ' || p_period_label || ' report',
    'It is now archived — see Report.',
    null, me
  from public.profiles p
  where p.active;
end $$;
revoke execute on function public.finalize_report_period(text, text) from public, anon;
grant execute on function public.finalize_report_period(text, text) to authenticated;

-- Records where the auto-saved PDF landed, once it's been generated and
-- uploaded client-side (Google Drive, same integration the report already
-- uses). Admin-only, idempotent.
create or replace function public.set_report_period_drive_link(p_period_type text, p_period_label text, p_drive_link text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select public.current_user_role()) is distinct from 'admin' then
    raise exception 'Only an admin can record a report''s Drive link';
  end if;
  update public.report_periods
     set drive_link = p_drive_link, drive_saved_at = now()
   where period_type = p_period_type and period_label = p_period_label;
end $$;
revoke execute on function public.set_report_period_drive_link(text, text, text) from public, anon;
grant execute on function public.set_report_period_drive_link(text, text, text) to authenticated;

-- The daily job: auto-finalizes any report that has sat "pending" for more
-- than 2 days (the admin never clicked "Close now"). It never opens a period
-- itself — only a signed-in admin's browser can compute a snapshot — so a
-- period nobody ever looked at simply has no archive.
create or replace function public.process_report_periods()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec     record;
  system_actor_id uuid;
begin
  select id into system_actor_id from public.profiles
  where active and role::text in ('admin', 'developer', 'support')
  order by created_at, id limit 1;

  for rec in
    select * from public.report_periods
    where status = 'pending' and pending_since <= now() - interval '2 days'
  loop
    update public.report_periods
       set status = 'finalized', finalized_at = now(), finalized_by = null
     where id = rec.id;

    insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
    select p.id, 'period_closed',
      rec.period_label || ' report has been archived',
      'Nobody closed it within 2 days, so it closed automatically.',
      null, system_actor_id
    from public.profiles p
    where p.active;
  end loop;
end $$;
-- Nightly pg_cron job only (matches purge_deactivated_accounts' lockdown, see
-- supabase/checks/function-privileges.sql).
revoke execute on function public.process_report_periods() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule('report-periods')
      where exists (select 1 from cron.job where jobname = 'report-periods');
    perform cron.schedule('report-periods', '20 3 * * *',
      $cron$ select public.process_report_periods(); $cron$);
  end if;
exception when others then
  raise notice 'pg_cron scheduling for report-periods skipped: %', sqlerrm;
end $$;
