-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

-- ---------------------------------------------------------------
-- 18. Print queue file marks (migration 20261009150000_print_queue_reception_file_marks)
-- ---------------------------------------------------------------
-- 2. Which files of a print job were opened / printed (shared, live). Opening
--    or downloading a file from the Print Queue marks it Opened (the first
--    open is kept); the operator or reception ticks each file Printed. Who and
--    when are stamped here, never taken from the browser.
create table if not exists public.print_file_marks (
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  file_url      text not null check (char_length(file_url) <= 2048),
  opened_at     timestamptz,
  opened_by     uuid references public.profiles(id) on delete set null,
  printed_at    timestamptz,
  printed_by    uuid references public.profiles(id) on delete set null,
  -- Approved (20261021100000_file_approval_and_artist_credits): a notice only
  -- — an artist, reception or admin ticks a file cleared to print. Never
  -- required to send to print or to mark a file printed/Done.
  approved_at   timestamptz,
  approved_by   uuid references public.profiles(id) on delete set null,
  primary key (work_order_id, file_url)
);
create index if not exists print_file_marks_opened_by_idx   on public.print_file_marks (opened_by);
create index if not exists print_file_marks_printed_by_idx  on public.print_file_marks (printed_by);
create index if not exists print_file_marks_approved_by_idx on public.print_file_marks (approved_by);
alter table public.print_file_marks enable row level security;

drop policy if exists print_file_marks_select on public.print_file_marks;
create policy print_file_marks_select on public.print_file_marks
  for select to authenticated using (true);
drop policy if exists print_file_marks_insert on public.print_file_marks;
create policy print_file_marks_insert on public.print_file_marks
  for insert to authenticated
  with check ((select public.current_user_role()) in ('operator', 'receptionist', 'admin', 'artist'));
drop policy if exists print_file_marks_update on public.print_file_marks;
create policy print_file_marks_update on public.print_file_marks
  for update to authenticated
  using ((select public.current_user_role()) in ('operator', 'receptionist', 'admin', 'artist'))
  with check ((select public.current_user_role()) in ('operator', 'receptionist', 'admin', 'artist'));
drop policy if exists print_file_marks_delete on public.print_file_marks;
create policy print_file_marks_delete on public.print_file_marks
  for delete to authenticated using ((select public.current_user_role()) = 'admin');

revoke all on public.print_file_marks from anon;
grant select, insert, update, delete on public.print_file_marks to authenticated;

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
revoke execute on function public.print_file_marks_stamp() from public, anon, authenticated;
drop trigger if exists print_file_marks_stamp_trg on public.print_file_marks;
create trigger print_file_marks_stamp_trg
  before insert or update on public.print_file_marks
  for each row execute function public.print_file_marks_stamp();

-- A job returned for a reprint needs every file printed again.
create or replace function public.print_file_marks_reprint()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.reprint_count > old.reprint_count then
    update public.print_file_marks set printed_at = null, printed_by = null
     where work_order_id = new.id and printed_at is not null;
  end if;
  return new;
end $$;
revoke execute on function public.print_file_marks_reprint() from public, anon, authenticated;
drop trigger if exists print_file_marks_reprint_trg on public.work_orders;
create trigger print_file_marks_reprint_trg
  after update of reprint_count on public.work_orders
  for each row execute function public.print_file_marks_reprint();

-- Everyone at the queue sees a mark at once.
do $$ begin
  alter publication supabase_realtime add table public.print_file_marks;
exception when duplicate_object then null; end $$;
