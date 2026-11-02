-- Replace the quarterly-only artist file-credit archive with a period-
-- agnostic report archive (Monthly / Quarterly / Yearly), 2026-10-22.
--
-- The quarterly feature (20261021100000_file_approval_and_artist_credits.sql)
-- was never pushed to the live project, so retiring its objects here is safe.
-- "Art done" everywhere (Workload table, every report tab) is now simply the
-- count of file_credit_events in the period — adding a file adds a credit,
-- removing one (revoke_file_credit) takes it back. The richer per-period
-- report snapshot (makers/artists/printers, same shape the UI already
-- computes from work_order_events) is written by the client the first time
-- an admin opens a report tab after a period ends, through open_report_period
-- — not recomputed a second time in SQL, so there is only one place that
-- logic can drift.
--
-- Additive in spirit even though it drops last week's un-launched tables:
-- nothing here has ever been applied to the live database.

-- ---------------------------------------------------------------
-- 1. Symmetric file-credit removal
-- ---------------------------------------------------------------
-- Takes back whatever credit a file earned when it's removed from a task,
-- regardless of who removes it (the credit was for the art existing, not for
-- the act of removing it). A silent no-op if no such credit exists.
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

-- ---------------------------------------------------------------
-- 2. Retire the quarterly-only archive
-- ---------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    perform cron.unschedule('quarterly-credits')
      where exists (select 1 from cron.job where jobname = 'quarterly-credits');
  end if;
exception when others then
  raise notice 'pg_cron unschedule of quarterly-credits skipped: %', sqlerrm;
end $$;

drop function if exists public.process_quarterly_credits();
drop function if exists public.finalize_quarterly_credits(text);
drop table if exists public.quarterly_credit_records;

-- ---------------------------------------------------------------
-- 3. Notification kinds: quarter_* -> period_* (generalized)
-- ---------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add  constraint notifications_kind_check
  check (kind in ('assign', 'message', 'mention', 'comment', 'printed', 'finished', 'queued', 'problem',
                  'materials', 'materials_released', 'low_stock',
                  'period_ready', 'period_closed'));

-- ---------------------------------------------------------------
-- 4. report_periods — a frozen snapshot per month/quarter/year, admin-only
-- ---------------------------------------------------------------
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

-- The client's one write path for a freshly-ended period: it computes the
-- snapshot with the same credits() logic the live report already uses, and
-- hands it here. A second admin opening the same tab moments later is a
-- harmless no-op (unique period_type+period_label).
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
-- period that nobody ever looked at simply has no archive, same gap the
-- quarterly-only version had.
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
