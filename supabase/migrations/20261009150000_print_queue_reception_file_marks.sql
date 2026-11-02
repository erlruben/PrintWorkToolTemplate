-- Print queue, 2026-10-09:
--  * Reception runs the print queue like an operator: Preparing / Printing /
--    On pause, the timer, pages, Report a problem and marking the job Printed
--    (besides assigning the operator and priority, which it already could).
--    When reception marks a job printed, the print is credited to the operator
--    on it, so their workload stays right.
--  * Files of a print job are highlighted once opened or printed (new table
--    print_file_marks, shared and live).
--
-- 1. work_orders_guard: the same rules as live, with reception allowed to run
--    the print (four small changes; nothing else in it moves).
CREATE OR REPLACE FUNCTION public.work_orders_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  caller  app_role  := public.current_user_role();
  my_site work_site;
  added   boolean;
begin
  -- An artist opens a task only at the start of the flow (To Do / In progress);
  -- they cannot create one already finished, queued, printed, released or
  -- archived. (The New Work Order form never sets these; this guards the API.)
  if tg_op = 'INSERT' and caller = 'artist'
     and (new.date_finished is not null or new.queued_at is not null
          or new.printed_at is not null or new.released_at is not null
          or new.archived_at is not null) then
    raise exception 'An artist can only open a task in To Do or In progress';
  end if;
  -- Nobody but an admin creates a job straight into the Trash (migration 040).
  if tg_op = 'INSERT' and new.deleted_at is not null and caller <> 'admin' then
    raise exception 'Only an admin can delete or restore a work order';
  end if;

  -- Giving a To Do task to an artist starts it: it moves to In progress on its
  -- own (migration 042). Moving it back to To Do by hand still works.
  if new.artist_id is not null
     and new.artist_id is distinct from (case when tg_op = 'UPDATE' then old.artist_id end)
     and coalesce(new.stage, 'todo') = 'todo'
     and new.date_finished is null then
    new.stage := 'in_progress';
  end if;

  -- A job that has its file(s) is ready for review — File Attached for Review
  -- (Finished) — whether or not it has an artist yet:
  --  • creating a job with a file makes it Finished straight away (045; since
  --    047 an artist is no longer needed for this);
  --  • giving a To Do job that already has its file to an artist makes it
  --    Finished too, instead of only starting it (047). A job that was sent
  --    back to its artist is In progress, not To Do, so reassigning it does not.
  if new.file_link is not null and new.date_finished is null and new.printed_at is null
     and (tg_op = 'INSERT'
          or (new.artist_id is not null
              and new.artist_id is distinct from (case when tg_op = 'UPDATE' then old.artist_id end)
              and coalesce((case when tg_op = 'UPDATE' then old.stage end), 'todo') = 'todo')) then
    new.date_finished := greatest(current_date, new.date_given);
    new.stage := 'in_progress';
  end if;

  -- Only an artist can be given a task, and only a printer operator can be
  -- assigned to print it (049) — admins, reception and the new roles are not
  -- assignable. Clearing an assignment is always fine.
  if new.artist_id is not null
     and new.artist_id is distinct from (case when tg_op = 'UPDATE' then old.artist_id end)
     and not exists (select 1 from public.profiles where id = new.artist_id and role = 'artist') then
    raise exception 'Only an artist can be assigned to a task';
  end if;
  if new.operator_id is not null
     and new.operator_id is distinct from (case when tg_op = 'UPDATE' then old.operator_id end)
     and not exists (select 1 from public.profiles where id = new.operator_id and role = 'operator') then
    raise exception 'Only a printer operator can be assigned to print';
  end if;

  if tg_op = 'UPDATE' then
    -- A problem at the press (048): wrong item to print, broken print, broken
    -- printer, other. The operator, reception (2026-10-09) or an admin reports
    -- it — the press stops, so a running timer pauses — and clears it.
    if new.print_problem is distinct from old.print_problem then
      if new.print_problem is not null then
        if caller not in ('operator', 'admin', 'receptionist') then
          raise exception 'Only a printer operator, reception or an admin can report a problem';
        end if;
        new.print_problem_at := now();
        new.print_problem_by := auth.uid();
        if new.print_state in ('preparing', 'printing') then
          new.print_state := 'paused';
        end if;
      else
        if caller not in ('operator', 'admin', 'receptionist') then
          raise exception 'Only the operator, reception or an admin can clear a problem';
        end if;
        new.print_problem_note := null;
        new.print_problem_at := null;
        new.print_problem_by := null;
      end if;
    end if;

    if new.printed_at is distinct from old.printed_at then
      -- Marking a job printed: an operator, reception (who runs the print queue
      -- too since 2026-10-09) or an admin. Reception may also CLEAR it (a return
      -- for reprint); the field-lock further down still stops reception from
      -- touching the job's content.
      if new.printed_at is not null then
        if caller not in ('operator', 'admin', 'receptionist') then
          raise exception 'Only a printer operator, reception or an admin can mark a work order as printed';
        end if;
      elsif caller not in ('operator', 'admin', 'receptionist') then
        raise exception 'Only a printer operator or reception can return a printed job';
      end if;
      if new.printed_at is null then
        new.printed_by := null;
        new.printed_site := null;
        new.printed_file_link := null;
        -- Not printed any more, so not For Release / Released either (046).
        new.ready_for_pickup_at := null;
        new.released_at := null;
        new.released_by := null;
        -- A reprint starts its page count again (048).
        new.printed_items := '[]'::jsonb;
      else
        -- Who printed it: the person ticking it off — but when reception does
        -- it for a job an operator is on, the print is that operator's (their
        -- workload and printing area count it).
        new.printed_by := case when caller = 'receptionist' and new.operator_id is not null
                               then new.operator_id else auth.uid() end;
        select site into my_site from public.profiles where id = new.printed_by;
        new.printed_site := coalesce(my_site, new.target_site);
        -- What was on the ticket at the moment of printing (PRD §7).
        new.printed_file_link := new.file_link;
        -- Marking a job fully printed accounts for every ordered piece — per
        -- item too (048).
        if new.qty is not null then
          new.printed_qty := new.qty;
        end if;
        if jsonb_array_length(new.items) > 0 then
          new.printed_items := (select coalesce(jsonb_agg(coalesce((i->>'qty')::numeric, 0)), '[]'::jsonb)
                                from jsonb_array_elements(new.items) i);
        end if;
        -- Printed: any problem is over, and a return note has been dealt with.
        new.print_problem := null;
        new.print_problem_note := null;
        new.print_problem_at := null;
        new.print_problem_by := null;
        new.return_note := null;
      end if;
    end if;

    -- Pages printed per item (048): the total is always their sum.
    if new.printed_items is distinct from old.printed_items and jsonb_array_length(new.printed_items) > 0 then
      new.printed_qty := (select coalesce(sum((e #>> '{}')::numeric), 0)::int
                          from jsonb_array_elements(new.printed_items) e);
    end if;

    -- The Trash Bin: since migration 046 everyone signed in may move a job to
    -- the Trash and restore it (an artist only their own, by the row rules).
    -- Deleting for good stays admin-only (the delete policy).
    if new.deleted_at is distinct from old.deleted_at and caller is null then
      raise exception 'Sign in to delete or restore a work order';
    end if;

    -- Manual archive of printed outputs — admin only, printed jobs only.
    if new.archived_at is distinct from old.archived_at then
      if caller <> 'admin' then
        raise exception 'Only an admin can archive a work order';
      end if;
      if new.archived_at is not null and new.printed_at is null then
        raise exception 'Only a printed work order can be archived';
      end if;
    end if;

    -- Sending a job to print — by an admin or reception (042), or the artist
    -- straight from their own job (046) — and only for a finished job. (An
    -- operator can pull one back out — allowed by the column rules below.)
    if new.queued_at is distinct from old.queued_at and new.queued_at is not null then
      if caller not in ('admin', 'receptionist', 'artist') then
        raise exception 'Only an admin, reception or the artist can send a job to print';
      end if;
      if new.date_finished is null then
        raise exception 'Finish the job before sending it to print';
      end if;
    end if;

    -- An operator may claim a free job, or take over one already claimed (an
    -- absent operator's), but only TO themselves. Releasing stays own-claim only;
    -- an admin can reassign a job to anyone.
    if caller = 'operator' and new.operator_id is distinct from old.operator_id then
      if new.operator_id is not null then
        if new.operator_id <> auth.uid() then
          raise exception 'An operator can only assign the print to themselves';
        end if;
      elsif old.operator_id is distinct from auth.uid() then
        raise exception 'An operator can only release their own claim';
      end if;
    end if;

    -- Reception runs the print queue as an operator does (2026-10-09): the
    -- state, timer and pages — besides assigning the operator and priority.
    -- (Until then this was operator-only, migration 046.)

    -- For Release (046): reception or an admin checked the print and it is good,
    -- waiting for the customer. Only a printed job; anyone may clear it as part
    -- of un-printing (handled above).
    if new.ready_for_pickup_at is distinct from old.ready_for_pickup_at and new.ready_for_pickup_at is not null then
      if caller not in ('admin', 'receptionist') then
        raise exception 'Only admin or reception can mark a job For Release';
      end if;
      if new.printed_at is null then
        raise exception 'Only a printed job can be For Release';
      end if;
    end if;

    -- An operator drives a job through the queue: the printed check-off, the
    -- queue state, the claim, the timer, the pieces-printed count, the total
    -- pages (qty), priority, and pulling a job back out of the queue (clearing
    -- queued_at). Everything else that describes the job stays off-limits.
    if caller = 'operator' and (
         new.wo_number        is distinct from old.wo_number        or
         new.job_order_number is distinct from old.job_order_number or
         new.artist_id        is distinct from old.artist_id        or
         new.description      is distinct from old.description      or
         new.material         is distinct from old.material         or
         new.laminating       is distinct from old.laminating       or
         new.notes            is distinct from old.notes            or
         new.date_given       is distinct from old.date_given       or
         new.date_due         is distinct from old.date_due         or
         new.date_finished    is distinct from old.date_finished    or
         new.preview_path     is distinct from old.preview_path     or
         new.file_link        is distinct from old.file_link        or
         new.attachments      is distinct from old.attachments      or
         new.items            is distinct from old.items            or
         new.operator_note    is distinct from old.operator_note
       ) then
      raise exception 'A printer operator can only drive a job through the queue';
    end if;

    -- Finished work locks for reception and artists — it is the client's record,
    -- waiting for review. Reception is the exception: they review a finished job
    -- — Send to print (queued_at) or Send back (clearing date_finished, before it
    -- is printed; migration 042) — and run the post-print review — the Job Order
    -- number, Release (released_at/by) and Return (clearing printed_at with the
    -- print-progress resets and the reprint tally). They still may not touch the
    -- job's DESCRIPTIVE content, so those fields must stay unchanged.
    -- The files stay open until the job is sent to print (migration 044): on a
    -- Finished job the artist (their own, by the row rules) and reception may
    -- still add or remove files — and nothing else — and it stays Finished.
    -- Reception may also (re)assign the artist there (047), since a job with its
    -- file is Finished even before it has one.
    -- The artist (their own job, by the row rules) can change anything until
    -- printing has started — an operator has taken it or set it going, or it is
    -- printed. After that only an admin can (046).
    if caller = 'artist'
       and (old.operator_id is not null or old.print_state is not null or old.printed_at is not null)
       and (to_jsonb(new) - 'updated_at' - 'status' - 'days_to_finish')
           <> (to_jsonb(old) - 'updated_at' - 'status' - 'days_to_finish') then
      raise exception 'Printing has started — only an admin can change this job now';
    end if;

    if caller = 'receptionist'
       and (old.date_finished is not null or old.queued_at is not null or old.printed_at is not null) then
      if not ((old.queued_at is null and old.printed_at is null
               and (to_jsonb(new) - 'file_link' - 'attachments' - 'artist_id' - 'updated_at' - 'status' - 'days_to_finish')
                   = (to_jsonb(old) - 'file_link' - 'attachments' - 'artist_id' - 'updated_at' - 'status' - 'days_to_finish'))
              or (caller = 'receptionist'
              and new.wo_number     is not distinct from old.wo_number
              and new.artist_id     is not distinct from old.artist_id
              and new.description   is not distinct from old.description
              and new.material      is not distinct from old.material
              and new.laminating    is not distinct from old.laminating
              and new.urgency       is not distinct from old.urgency
              and new.notes         is not distinct from old.notes
              and new.date_given    is not distinct from old.date_given
              and new.date_due      is not distinct from old.date_due
              and (new.date_finished is not distinct from old.date_finished
                   or (new.date_finished is null and old.printed_at is null))
              and new.target_site   is not distinct from old.target_site
              and new.qty           is not distinct from old.qty
              and new.file_link     is not distinct from old.file_link
              and new.attachments   is not distinct from old.attachments
              and new.items         is not distinct from old.items
              and new.preview_path  is not distinct from old.preview_path)) then
        raise exception 'A finished work order can only be changed by an admin';
      end if;
    end if;

    -- Adding a print file to an open job (a Drive upload, a pick or a pasted
    -- link) marks it Finished on its own, ready for review by an admin or
    -- reception — whoever adds it (migration 042; anyone since 043). Only a file
    -- that wasn't on the job before counts — removing one, or reordering, does
    -- not finish it. Creating a job with a file attached does not either.
    if new.file_link is not null
       and old.date_finished is null and new.date_finished is null
       and new.printed_at is null then
      select exists (
        select 1
        from (select new.file_link as url
              union all
              select e->>'url' from jsonb_array_elements(new.attachments) e) n
        where n.url is not null
          and n.url is distinct from old.file_link
          and not old.attachments @> jsonb_build_array(jsonb_build_object('url', n.url))
      ) into added;
      if added then
        new.date_finished := greatest(current_date, new.date_given);
        new.stage := 'in_progress';
      end if;
    end if;

    -- Resuming from pause rebuilds the countdown from the seconds that were left.
    if old.print_state = 'paused' and new.print_state is distinct from old.print_state then
      if new.print_state in ('preparing', 'printing')
         and new.print_pause_left is not null and new.printed_at is null then
        new.print_eta := now() + make_interval(secs => new.print_pause_left);
      end if;
      new.print_pause_left := null;
    end if;
    -- While a job is On pause, a timer never runs — freeze it as seconds left.
    if new.print_state = 'paused' and new.print_eta is not null then
      new.print_pause_left := greatest(0, ceil(extract(epoch from (new.print_eta - now()))))::int;
      new.print_eta := null;
    end if;
  end if;

  -- Finishing needs the print-ready file — except that an admin or reception
  -- may move a task to File Attached for Review without one (049; e.g. the
  -- operator works from the operator note). Taking the last file off a
  -- Finished job that isn't printed sends it back to In progress (045).
  if new.date_finished is not null and new.file_link is null then
    if tg_op = 'UPDATE' and old.file_link is not null and new.printed_at is null then
      new.date_finished := null;
      new.stage := 'in_progress';
    elsif (tg_op = 'INSERT' or old.date_finished is null) and caller not in ('admin', 'receptionist') then
      raise exception 'Attach the print-ready Drive link before finishing this job';
    end if;
  end if;

  -- Un-finishing pulls it back out of the queue.
  if new.date_finished is null then
    new.queued_at := null;
  end if;

  -- The operator's clock starts when the job is sent to print.
  if new.queued_at is not null and new.ready_at is null then
    new.ready_at := new.queued_at;
  end if;
  -- Leaving the queue clears the live bits so a re-queued job starts fresh.
  if new.queued_at is null then
    new.ready_at := null;
    new.operator_id := null;
    new.print_state := null;
    new.print_eta := null;
    new.print_problem := null;
    new.print_problem_note := null;
    new.print_problem_at := null;
    new.print_problem_by := null;
  end if;

  -- (Since 049 a job with no file can be printed: admin or reception let it
  -- through review, and the operator works from the operator note.)

  -- A job can't be finished before it was given out.
  if new.date_finished is not null and new.date_finished < new.date_given then
    raise exception 'Finished date cannot be earlier than the date given';
  end if;

  new.updated_at := now();
  return new;
end $function$;

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
  primary key (work_order_id, file_url)
);
create index if not exists print_file_marks_opened_by_idx  on public.print_file_marks (opened_by);
create index if not exists print_file_marks_printed_by_idx on public.print_file_marks (printed_by);
alter table public.print_file_marks enable row level security;

drop policy if exists print_file_marks_select on public.print_file_marks;
create policy print_file_marks_select on public.print_file_marks
  for select to authenticated using (true);
drop policy if exists print_file_marks_insert on public.print_file_marks;
create policy print_file_marks_insert on public.print_file_marks
  for insert to authenticated
  with check ((select public.current_user_role()) in ('operator', 'receptionist', 'admin'));
drop policy if exists print_file_marks_update on public.print_file_marks;
create policy print_file_marks_update on public.print_file_marks
  for update to authenticated
  using ((select public.current_user_role()) in ('operator', 'receptionist', 'admin'))
  with check ((select public.current_user_role()) in ('operator', 'receptionist', 'admin'));
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
