-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.
-- Not here: the push webhook `push_on_notification` (Database → Webhooks) —
-- it holds a secret key; see supabase/README.md.

-- ---------------------------------------------------------------
-- 6e. Notifications inbox — one row per person per event, read/unread. Rows
--     are created only by the triggers below (assignment, message), never by
--     clients, so a notification can't be forged.
-- ---------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('assign', 'message', 'mention', 'comment', 'printed', 'finished', 'queued', 'problem')),
  title      text not null,
  body       text,
  ref_id     uuid,
  actor_id   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_actor_id_idx on public.notifications (actor_id);

-- Update the kind check in place for a database created before mentions (029),
-- the printed notice (036), the finished notice (037) or the problem notice
-- (048); the inline check above only lands on a fresh install.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add  constraint notifications_kind_check
  check (kind in ('assign', 'message', 'mention', 'comment', 'printed', 'finished', 'queued', 'problem',
                  'materials', 'materials_released', 'low_stock',
                  -- monthly/quarterly/yearly report archive (20261022120000_report_periods, 22_artist_file_credits.sql)
                  'period_ready', 'period_closed',
                  -- a printing area's printer broken / fixed (20261027110000_printer_status, 23_printer_status.sql)
                  'printer'));

alter table public.notifications enable row level security;
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, update, delete on public.notifications to authenticated;

create or replace function public.notify_assignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.artist_id is not null
     and new.artist_id is distinct from (case when tg_op = 'UPDATE' then old.artist_id end)
     and new.artist_id is distinct from auth.uid() then
    insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
    values (
      new.artist_id, 'assign',
      coalesce((select full_name from public.profiles where id = auth.uid()), 'The office') || ' assigned you a task',
      new.wo_number || case when coalesce(new.description, '') <> '' then ' — ' || new.description else '' end,
      new.id, auth.uid()
    );
  end if;
  return new;
end $$;
drop trigger if exists notify_assignment_trg on public.work_orders;
create trigger notify_assignment_trg
  after insert or update of artist_id on public.work_orders
  for each row execute function public.notify_assignment();

-- Assigned to print (049): when someone else assigns an operator to a job, that
-- operator is told. (An operator taking a job themselves needs no notice.)
create or replace function public.notify_operator_assignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.operator_id is not null
     and new.operator_id is distinct from old.operator_id
     and new.operator_id is distinct from auth.uid() then
    insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
    values (
      new.operator_id, 'assign',
      coalesce((select full_name from public.profiles where id = auth.uid()), 'The office') || ' assigned you to print',
      new.wo_number || case when coalesce(new.description, '') <> '' then ' — ' || new.description else '' end,
      new.id, auth.uid()
    );
  end if;
  return new;
end $$;
drop trigger if exists notify_operator_assignment_trg on public.work_orders;
-- queued_at too: sending to print sets the operator picked ahead (2026-10-20).
create trigger notify_operator_assignment_trg
  after update of operator_id, queued_at on public.work_orders
  for each row execute function public.notify_operator_assignment();

-- Tell reception (and admins) the moment an operator finishes printing a file, so
-- they can check it and Release or Return it (migration 036).
create or replace function public.notify_printed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.printed_at is not null and old.printed_at is null then
    insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
    select p.id, 'printed',
      coalesce((select full_name from public.profiles where id = auth.uid()), 'The operator')
        || ' printed ' || new.wo_number,
      case when coalesce(new.description, '') <> '' then new.description else 'Ready to check.' end,
      new.id, auth.uid()
    from public.profiles p
    where p.role::text in ('receptionist', 'admin', 'developer', 'support')
      and p.active
      and p.id is distinct from auth.uid();
  end if;
  return new;
end $$;
-- Switched off (049): people are notified only when they are tagged in a
-- comment, sent a chat message, or assigned to a task. The function is kept.
drop trigger if exists notify_printed_trg on public.work_orders;

-- Tell the admins and reception the moment an artist marks a job Finished, so it
-- doesn't wait on someone watching the board to review it and send it to print
-- (migration 037; reception added in 042). It fires on any update because the
-- guard above can finish a job on its own when the print file is attached, and
-- on insert because a job created with its artist and files starts Finished (045).
create or replace function public.notify_finished()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.date_finished is not null
     and (case when tg_op = 'UPDATE' then old.date_finished end) is null then
    insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
    select p.id, 'finished',
      coalesce((select full_name from public.profiles where id = auth.uid()), 'An artist')
        || ' finished ' || new.wo_number,
      case when coalesce(new.description, '') <> '' then new.description
           else 'Ready to review and send to print.' end,
      new.id, auth.uid()
    from public.profiles p
    where p.role::text in ('admin', 'developer', 'support', 'receptionist')
      and p.active
      and p.id is distinct from auth.uid();
  end if;
  return new;
end $$;
-- Switched off (049): people are notified only when they are tagged in a
-- comment, sent a chat message, or assigned to a task. The function is kept.
drop trigger if exists notify_finished_trg on public.work_orders;

-- Tell the operators the moment a job is sent to print, so their phones buzz
-- even with the app closed (migration 039). A job with no printing area goes to
-- every operator; an operator with no area hears about every job.
create or replace function public.notify_queued()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.queued_at is not null and old.queued_at is null then
    insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
    select p.id, 'queued',
      'New file to print — ' || new.wo_number,
      case when coalesce(new.description, '') <> '' then new.description
           else 'Open the Print Queue.' end,
      new.id, auth.uid()
    from public.profiles p
    where p.role = 'operator'
      and p.active
      and (new.target_site is null or p.site is null or p.site = new.target_site)
      and p.id is distinct from auth.uid();
  end if;
  return new;
end $$;
-- Switched off (049): people are notified only when they are tagged in a
-- comment, sent a chat message, or assigned to a task. The function is kept.
drop trigger if exists notify_queued_trg on public.work_orders;

-- Tell reception and the admins the moment an operator reports a problem at the
-- press (048) — and the artist too when it is the wrong item to print.
create or replace function public.notify_problem()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.print_problem is not null and new.print_problem is distinct from old.print_problem then
    insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
    select p.id, 'problem',
      coalesce((select full_name from public.profiles where id = auth.uid()), 'The operator')
        || ' reported a problem on ' || new.wo_number,
      case new.print_problem
        when 'wrong_item'   then 'Wrong item to print'
        when 'broken_print' then 'Broken print'
        when 'printer_down' then 'Broken printer'
        else 'Problem'
      end || coalesce(' — ' || nullif(btrim(new.print_problem_note), ''), ''),
      new.id, auth.uid()
    from public.profiles p
    where p.active
      and p.id is distinct from auth.uid()
      and (p.role::text in ('receptionist', 'admin', 'developer', 'support')
           or (new.print_problem = 'wrong_item' and p.id = new.artist_id));
  end if;
  return new;
end $$;
-- Switched off (049): people are notified only when they are tagged in a
-- comment, sent a chat message, or assigned to a task. The function is kept.
drop trigger if exists notify_problem_trg on public.work_orders;

create or replace function public.notify_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
  values (
    new.recipient_id, 'message',
    coalesce((select full_name from public.profiles where id = new.sender_id), 'Someone') || ' sent you a message',
    new.body, new.sender_id, new.sender_id
  );
  return new;
end $$;
drop trigger if exists notify_message_trg on public.direct_messages;
create trigger notify_message_trg
  after insert on public.direct_messages
  for each row execute function public.notify_message();
