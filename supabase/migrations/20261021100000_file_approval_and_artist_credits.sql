-- File approval + quarterly artist file-credits, 2026-10-21 (client request).
--
--  * print_file_marks gains approved_at/approved_by: an artist, reception or
--    admin can tick a file "Approved" to tell operators it's cleared to print.
--    Notice only — it never blocks Send to print or Mark printed/Done.
--  * file_credit_events: one row per file an ARTIST adds to a task (1 credit
--    each; adds by other roles don't count). Written only through
--    log_file_credit(), never a raw client insert.
--  * quarterly_credit_records: a frozen per-quarter snapshot, admin-only. A
--    daily job opens a "pending" record once a quarter ends and tells the
--    admins; if nobody closes it within 2 days it finalizes itself and tells
--    everyone. The unattended path's notifications are attributed to a
--    own account (no auth.uid() exists in a cron context) — a manual close
--    (finalize_quarterly_credits) attributes to whichever admin closed it.
--
-- Additive only: new columns are nullable, new tables are new, existing RLS
-- policies gain roles rather than losing them.

-- ---------------------------------------------------------------
-- 1. Approved mark on a file (same table/key as opened/printed)
-- ---------------------------------------------------------------
alter table public.print_file_marks add column if not exists approved_at timestamptz;
alter table public.print_file_marks add column if not exists approved_by uuid references public.profiles(id) on delete set null;
create index if not exists print_file_marks_approved_by_idx on public.print_file_marks (approved_by);

-- An artist may now mark their own uploads approved (previously operator/
-- receptionist/admin only).
drop policy if exists print_file_marks_insert on public.print_file_marks;
create policy print_file_marks_insert on public.print_file_marks
  for insert to authenticated
  with check ((select public.current_user_role()) in ('operator', 'receptionist', 'admin', 'artist'));
drop policy if exists print_file_marks_update on public.print_file_marks;
create policy print_file_marks_update on public.print_file_marks
  for update to authenticated
  using ((select public.current_user_role()) in ('operator', 'receptionist', 'admin', 'artist'))
  with check ((select public.current_user_role()) in ('operator', 'receptionist', 'admin', 'artist'));

create or replace function public.print_file_marks_stamp()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Opened: the first open stays; a later one never moves it.
  if tg_op = 'UPDATE' and old.opened_at is not null then
    new.opened_at := old.opened_at;
    new.opened_by := old.opened_by;
  elsif new.opened_at is not null then
    new.opened_at := now();
    new.opened_by := auth.uid();
  else
    new.opened_by := null;
  end if;
  -- Printed: stamped when ticked, cleared when unticked.
  if new.printed_at is null then
    new.printed_by := null;
  elsif tg_op = 'INSERT' or old.printed_at is null then
    new.printed_at := now();
    new.printed_by := auth.uid();
  else
    new.printed_at := old.printed_at;
    new.printed_by := old.printed_by;
  end if;
  -- Approved: same toggle shape as Printed — a notice only, never required.
  if new.approved_at is null then
    new.approved_by := null;
  elsif tg_op = 'INSERT' or old.approved_at is null then
    new.approved_at := now();
    new.approved_by := auth.uid();
  else
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------
-- 2. New notification kinds for the quarterly credits flow
-- ---------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add  constraint notifications_kind_check
  check (kind in ('assign', 'message', 'mention', 'comment', 'printed', 'finished', 'queued', 'problem',
                  'materials', 'materials_released', 'low_stock',
                  'quarter_ready', 'quarter_closed'));

-- ---------------------------------------------------------------
-- 3. Per-file artist credit — one row per uploaded file, artists only
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- 4. Quarterly archive — a frozen snapshot per quarter, admin-only
-- ---------------------------------------------------------------
create table if not exists public.quarterly_credit_records (
  id            uuid primary key default gen_random_uuid(),
  quarter_label text not null unique,            -- e.g. '2026-Q4'
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'pending' check (status in ('pending', 'finalized')),
  pending_since timestamptz not null default now(),
  finalized_at  timestamptz,
  finalized_by  uuid references public.profiles(id) on delete set null,  -- null = closed automatically
  lines         jsonb not null default '[]'::jsonb,   -- [{artist_id, artist_name, file_count}]
  created_at    timestamptz not null default now()
);

alter table public.quarterly_credit_records enable row level security;
drop policy if exists quarterly_credit_records_read on public.quarterly_credit_records;
create policy quarterly_credit_records_read on public.quarterly_credit_records
  for select to authenticated using ((select public.current_user_role()) = 'admin');
revoke all on public.quarterly_credit_records from anon, authenticated;
grant select on public.quarterly_credit_records to authenticated;

-- An admin closing a still-pending quarter early. The automatic 2-day close
-- (process_quarterly_credits, below) does the same update directly — this is
-- only the human-triggered path, so finalized_by records the real admin.
create or replace function public.finalize_quarterly_credits(p_quarter_label text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if (select public.current_user_role()) is distinct from 'admin' then
    raise exception 'Only an admin can close a quarter';
  end if;
  update public.quarterly_credit_records
     set status = 'finalized', finalized_at = now(), finalized_by = me
   where quarter_label = p_quarter_label and status = 'pending';
  if not found then
    raise exception 'No pending quarter record % to close', p_quarter_label;
  end if;
  insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
  select p.id, 'quarter_closed',
    coalesce((select full_name from public.profiles where id = me), 'An admin')
      || ' closed ' || p_quarter_label || ' artist credits',
    'The quarterly artist file-credits are now archived — see Admin → Artist Credits.',
    null, me
  from public.profiles p
  where p.active;
end $$;
revoke execute on function public.finalize_quarterly_credits(text) from public, anon;
grant execute on function public.finalize_quarterly_credits(text) to authenticated;

-- The daily job: opens next quarter's pending record once a quarter has
-- ended, and auto-finalizes a pending record 2 days after it was opened.
-- Both notification paths use a configured project account as the actor, since there is
-- no signed-in caller in a cron context (per his instruction, 2026-10-21).
create or replace function public.process_quarterly_credits()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today    date := current_date;
  q_start  date := date_trunc('quarter', today)::date - interval '3 months';
  q_endex  date := date_trunc('quarter', today)::date;  -- exclusive end = this quarter's start
  q_label  text;
  rec      public.quarterly_credit_records%rowtype;
  lines_js jsonb;
  system_actor_id uuid;
begin
  q_label := extract(year from q_start)::text || '-Q' || (((extract(month from q_start)::int - 1) / 3) + 1)::text;
  select id into system_actor_id from public.profiles
  where active and role::text in ('admin', 'developer', 'support')
  order by created_at, id limit 1;

  select * into rec from public.quarterly_credit_records where quarter_label = q_label;

  if not found then
    select coalesce(jsonb_agg(x.obj order by x.file_count desc), '[]'::jsonb) into lines_js
      from (
        select jsonb_build_object('artist_id', artist_id, 'artist_name', max(artist_name), 'file_count', count(*)) as obj,
               count(*) as file_count
        from public.file_credit_events
        where at >= q_start and at < q_endex and artist_id is not null
        group by artist_id
      ) x;

    insert into public.quarterly_credit_records (quarter_label, period_start, period_end, status, pending_since, lines)
    values (q_label, q_start, q_endex - 1, 'pending', now(), coalesce(lines_js, '[]'::jsonb));

    insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
    select p.id, 'quarter_ready',
      q_label || ' artist credits are ready to close',
      'Review it in Admin → Artist Credits — it closes on its own in 2 days if nobody acts.',
      null, system_actor_id
    from public.profiles p
    where p.role = 'admin' and p.active;

  elsif rec.status = 'pending' and rec.pending_since <= now() - interval '2 days' then
    update public.quarterly_credit_records
       set status = 'finalized', finalized_at = now(), finalized_by = null
     where id = rec.id;

    insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
    select p.id, 'quarter_closed',
      q_label || ' artist credits have been archived',
      'Nobody closed it within 2 days, so it closed automatically.',
      null, system_actor_id
    from public.profiles p
    where p.active;
  end if;
end $$;
-- Nightly pg_cron job only (matches purge_deactivated_accounts' lockdown, see
-- supabase/checks/function-privileges.sql).
revoke execute on function public.process_quarterly_credits() from public, anon, authenticated;

-- Schedule it once a day, right after the existing purge job; guarded the
-- same way (pg_cron may be unavailable locally, and the app works without it).
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule('quarterly-credits')
      where exists (select 1 from cron.job where jobname = 'quarterly-credits');
    perform cron.schedule('quarterly-credits', '20 3 * * *',
      $cron$ select public.process_quarterly_credits(); $cron$);
  end if;
exception when others then
  raise notice 'pg_cron scheduling for quarterly-credits skipped: %', sqlerrm;
end $$;
