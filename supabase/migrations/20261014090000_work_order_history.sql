-- History on every task, 2026-10-14 ("History in tasks is a must").
--
-- Until now a task only remembered its LATEST state: who printed it last, who
-- the artist is now. A reprint replaced the first printer, and when a person
-- left the shop their name came off every task they had worked on. So nobody
-- could look back and see who did what, and the credit counts drifted.
--
--  * work_order_events: one line each time something happens to a task — made,
--    given to an artist, file attached, sent back, waiting for the client,
--    sent to print, taken by an operator, printed, returned for a reprint, for
--    release, released, moved to the Trash or back. Each line keeps WHO did it
--    and WHO it is credited to, by id AND by name as it was that day, so the
--    line still reads right after the account is gone.
--  * The lines are written by the database itself (a trigger on work_orders).
--    The app can read them; nobody can add, change or remove one by hand.
--  * Printing is credited to the operator who took the job. Reception or an
--    admin pressing Finish for them does not take the credit; a job nobody
--    took is credited to the person who pressed Finish.
--  * Who MADE a task is now stamped by the database and cannot be changed.
--  * Existing tasks get the lines the database can still vouch for: made, art
--    done (first finished / first waiting for the client), printed (the latest
--    print), released.
--
-- Additive only: one new table, two functions, two triggers. No column of an
-- existing task is changed; the back-fill only adds lines to the new table.

create table if not exists public.work_order_events (
  id            bigint generated always as identity primary key,
  -- Emptying the Trash removes the task for good, and its history with it.
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  at            timestamptz not null default now(),
  kind          text not null,
  -- Who did it. No link to the account on purpose: the line must outlive it.
  actor_id      uuid,
  actor_name    text,
  -- Who it is credited to (the maker, the artist, the operator).
  person_id     uuid,
  person_name   text,
  note          text,
  constraint work_order_events_kind_chk check (kind in (
    'made', 'assigned', 'art_done', 'sent_back', 'client_wait', 'client_ok', 'to_print',
    'claimed', 'printed', 'reprint', 'problem', 'for_release', 'released', 'trashed', 'restored')),
  constraint work_order_events_note_chk check (char_length(coalesce(note, '')) <= 500)
);
create index if not exists work_order_events_order_idx on public.work_order_events (work_order_id, at);
create index if not exists work_order_events_credit_idx on public.work_order_events (kind, at);

alter table public.work_order_events enable row level security;
-- Everyone signed in reads the history (they already read every task). There
-- is no policy for writing: only the trigger below adds lines.
drop policy if exists work_order_events_read on public.work_order_events;
create policy work_order_events_read on public.work_order_events
  for select to authenticated using (true);
revoke all on public.work_order_events from anon, authenticated;
grant select on public.work_order_events to authenticated;

-- Who made a task: the person signed in, stamped here, kept for good.
create or replace function public.work_orders_maker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if me is not null then new.created_by := me; end if;
  elsif me is not null then
    -- (No signed-in person = the database itself, e.g. an account being removed.)
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
revoke execute on function public.work_orders_maker() from public, anon, authenticated;

drop trigger if exists work_orders_maker_trg on public.work_orders;
create trigger work_orders_maker_trg
  before insert or update on public.work_orders
  for each row execute function public.work_orders_maker();

-- One line per thing that happened. Runs after the task's own rules, so it
-- records what was really saved.
create or replace function public.work_orders_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  me_name text;
  printer uuid;
begin
  if me is not null then
    select full_name into me_name from public.profiles where id = me;
  end if;

  if tg_op = 'INSERT' then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, person_id, person_name)
    values (new.id, 'made', me, me_name, new.created_by,
            (select full_name from public.profiles where id = new.created_by));
    if new.artist_id is not null then
      insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, person_id, person_name)
      values (new.id, 'assigned', me, me_name, new.artist_id,
              (select full_name from public.profiles where id = new.artist_id));
    end if;
    if new.date_finished is not null and new.artist_id is not null then
      insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, person_id, person_name)
      values (new.id, 'art_done', me, me_name, new.artist_id,
              (select full_name from public.profiles where id = new.artist_id));
    end if;
    return null;
  end if;

  -- Given to an artist (or to another one).
  if new.artist_id is not null and new.artist_id is distinct from old.artist_id then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, person_id, person_name)
    values (new.id, 'assigned', me, me_name, new.artist_id,
            (select full_name from public.profiles where id = new.artist_id));
  end if;
  -- The artwork file is on the task (again, after a send back).
  if new.date_finished is not null and old.date_finished is null and new.artist_id is not null then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, person_id, person_name)
    values (new.id, 'art_done', me, me_name, new.artist_id,
            (select full_name from public.profiles where id = new.artist_id));
  end if;
  -- Sent back for changes.
  if new.sent_back_count > old.sent_back_count then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, person_id, person_name)
    values (new.id, 'sent_back', me, me_name, new.artist_id,
            (select full_name from public.profiles where id = new.artist_id));
  end if;
  -- Waiting for the client's approval, and approved.
  if new.client_wait_since is not null and old.client_wait_since is null then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, person_id, person_name)
    values (new.id, 'client_wait', me, me_name, new.artist_id,
            (select full_name from public.profiles where id = new.artist_id));
  elsif new.client_wait_since is null and old.client_wait_since is not null
        and new.queued_at is not distinct from old.queued_at and new.deleted_at is not distinct from old.deleted_at then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name)
    values (new.id, 'client_ok', me, me_name);
  end if;
  -- Sent to print.
  if new.queued_at is not null and old.queued_at is null then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name)
    values (new.id, 'to_print', me, me_name);
  end if;
  -- An operator took the job.
  if new.operator_id is not null and new.operator_id is distinct from old.operator_id and new.printed_at is null then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, person_id, person_name)
    values (new.id, 'claimed', me, me_name, new.operator_id,
            (select full_name from public.profiles where id = new.operator_id));
  end if;
  -- A problem at the press.
  if new.print_problem is not null and new.print_problem is distinct from old.print_problem then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, note)
    values (new.id, 'problem', me, me_name, left(concat_ws(': ', new.print_problem, nullif(new.print_problem_note, '')), 500));
  end if;
  -- Printed: the operator who took the job gets it; nobody took it → whoever ticked it off.
  if new.printed_at is not null and old.printed_at is null then
    printer := coalesce(new.operator_id, new.printed_by);
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, person_id, person_name)
    values (new.id, 'printed', me, me_name, printer,
            (select full_name from public.profiles where id = printer));
  end if;
  -- Returned for a reprint.
  if new.printed_at is null and old.printed_at is not null then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, note)
    values (new.id, 'reprint', me, me_name, left(nullif(new.return_note, ''), 500));
  end if;
  -- For release, and released to the client.
  if new.ready_for_pickup_at is not null and old.ready_for_pickup_at is null then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name)
    values (new.id, 'for_release', me, me_name);
  end if;
  if new.released_at is not null and old.released_at is null then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name, person_id, person_name)
    values (new.id, 'released', me, me_name, coalesce(new.released_by, me),
            (select full_name from public.profiles where id = coalesce(new.released_by, me)));
  end if;
  -- The Trash Bin.
  if new.deleted_at is not null and old.deleted_at is null then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name)
    values (new.id, 'trashed', me, me_name);
  elsif new.deleted_at is null and old.deleted_at is not null then
    insert into public.work_order_events (work_order_id, kind, actor_id, actor_name)
    values (new.id, 'restored', me, me_name);
  end if;
  return null;
end $$;
revoke execute on function public.work_orders_history() from public, anon, authenticated;

drop trigger if exists work_orders_history_trg on public.work_orders;
create trigger work_orders_history_trg
  after insert or update on public.work_orders
  for each row execute function public.work_orders_history();

-- The tasks that are already there: the lines the database can still vouch
-- for, once (a task that already has a "made" line is left alone). "from the
-- records" marks them as rebuilt, not seen live.
with fresh as (
  select w.* from public.work_orders w
  where not exists (select 1 from public.work_order_events e where e.work_order_id = w.id and e.kind = 'made')
), lines as (
  select f.id, f.created_at as at, 'made' as kind, f.created_by as person from fresh f
  union all
  select f.id,
         -- The day is known, the hour is not: noon in the shop.
         ((least(coalesce(f.first_finished_on, f.date_finished), f.client_wait_first_on)::timestamp + interval '12 hours') at time zone 'Asia/Manila'),
         case when f.client_wait_first_on is not null and f.client_wait_first_on < coalesce(f.first_finished_on, f.date_finished, 'infinity'::date)
              then 'client_wait' else 'art_done' end,
         f.artist_id
    from fresh f
   where f.artist_id is not null and coalesce(f.first_finished_on, f.date_finished, f.client_wait_first_on) is not null
  union all
  select f.id, f.printed_at, 'printed', coalesce(f.operator_id, f.printed_by) from fresh f where f.printed_at is not null
  union all
  select f.id, f.released_at, 'released', f.released_by from fresh f where f.released_at is not null
)
insert into public.work_order_events (work_order_id, at, kind, person_id, person_name, note)
select l.id, l.at, l.kind, l.person, p.full_name, 'from the records'
  from lines l left join public.profiles p on p.id = l.person
 order by l.at;
