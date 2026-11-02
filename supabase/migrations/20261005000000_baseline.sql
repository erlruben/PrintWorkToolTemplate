-- Baseline (2026-10-05): the whole database as it was live when the project
-- moved to Supabase CLI migrations — everything from the old schema.sql through
-- migration 049. On the live project this is recorded as already applied and
-- never runs; on a brand-new project `supabase db push` builds everything from it.
-- The old numbered files (002–049) are kept in supabase/archive/ for history.

-- PrintFlow Work Order Tracker schema.

-- ---------------------------------------------------------------
-- 1. Roles and profiles
-- ---------------------------------------------------------------
do $$ begin
  create type app_role as enum ('admin', 'receptionist', 'artist', 'operator');
exception when duplicate_object then null; end $$;
-- Tech Developer and Support (migration 049): full access, the same as admin.
alter type app_role add value if not exists 'developer';
alter type app_role add value if not exists 'support';

-- PRD §8: operators work at one of two printing areas.
do $$ begin
  create type work_site as enum ('office', 'production');
exception when duplicate_object then null; end $$;

-- How pressing a job is; null means unset.
do $$ begin
  create type urgency as enum ('low', 'mid', 'high', 'urgent');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  full_name            text not null,
  role                 app_role not null default 'artist',
  active               boolean not null default true,
  site                 work_site,          -- operators only; null otherwise
  must_change_password boolean not null default true,
  created_at           timestamptz not null default now()
);

-- Read the caller's role without tripping RLS recursion. Tech Developer and
-- Support (049) have total access, so every rule sees them as an admin.
create or replace function public.current_user_role()
returns app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when role::text in ('developer', 'support') then 'admin'::app_role else role end
  from public.profiles where id = auth.uid()
$$;

-- Every new auth user gets a profile. Lets the admin fall back to
-- creating people straight from the Supabase dashboard if needed.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, role, must_change_password, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'artist'),
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, true),
    -- Staff sign in with a username, stored as username@printflow.local; expose the
    -- username here. Owners with a real email have no username.
    case when new.email ilike '%@printflow.local' then split_part(new.email, '@', 1) else null end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- 2. Work orders
-- ---------------------------------------------------------------
create table if not exists public.work_orders (
  id            uuid primary key default gen_random_uuid(),
  wo_number     text not null unique,
  artist_id     uuid references public.profiles(id) on delete set null,
  description   text not null default '',
  material      text,
  laminating    text,
  urgency       urgency,
  notes         text,
  date_given    date not null default current_date,
  date_due      date,
  date_finished date,
  preview_path  text,          -- screenshot of the approved file (Supabase Storage)
  file_link     text,          -- Drive link (URL check added below, so it can be re-run)
  target_site   work_site,          -- which area prints it; null means either
  ready_at      timestamptz,        -- when it entered the print queue
  printed_at    timestamptz,
  printed_by    uuid references public.profiles(id) on delete set null,
  printed_site  work_site,
  printed_file_link text,       -- the link as it was at the moment of printing
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- PRD §6: status (below, so a re-run can update its definition) is never
  -- typed by hand — the Drive link is what moves a job to the print queue.

  -- PRD §4: days-to-finish, computed not tallied.
  days_to_finish integer generated always as (
    case when date_finished is not null then date_finished - date_given end
  ) stored
);

-- Bring an already-existing database up to date. The CREATE TABLE above is a
-- no-op when the table already exists, so these ALTERs add anything an older
-- copy is missing — letting this whole file be re-run to upgrade in place
-- rather than only build from scratch. Each is a no-op once present.
alter table public.work_orders add column if not exists urgency           urgency;
alter table public.work_orders add column if not exists target_site       work_site;
alter table public.work_orders add column if not exists ready_at          timestamptz;
alter table public.work_orders add column if not exists printed_site      work_site;
alter table public.work_orders add column if not exists printed_file_link text;
alter table public.work_orders add column if not exists archived_at       timestamptz;
-- The team's manual stage for the pre-print part of the flow: To Do -> In
-- progress. Once a file link or the print check-off appears, the status below
-- takes over, so the safeguards still hold.
alter table public.work_orders add column if not exists stage             text default 'todo';
-- The operator's live progress on a queued job: preparing / printing / paused.
alter table public.work_orders add column if not exists print_state       text;
alter table public.work_orders drop constraint if exists work_orders_print_state_chk;
alter table public.work_orders add  constraint work_orders_print_state_chk
  check (print_state is null or print_state in ('preparing', 'printing', 'paused'));
-- Set when an admin sends a finished job to the print queue (the review gate).
alter table public.work_orders add column if not exists queued_at         timestamptz;
-- The operator who claimed the print (self-assigned in the queue).
alter table public.work_orders add column if not exists operator_id       uuid references public.profiles(id) on delete set null;
-- The printer's expected finish time — shown as a live countdown on the queue.
alter table public.work_orders add column if not exists print_eta         timestamptz;
-- Seconds left on the printer timer, frozen while a job is On pause.
alter table public.work_orders add column if not exists print_pause_left  integer;
-- The official Job Order number in the customer records. Blank means the job is
-- not yet recorded (e.g. an artist opened it directly); the receptionist fills it.
alter table public.work_orders add column if not exists job_order_number  text;
-- How many pieces the job is for, and how many have been printed so far — so a
-- job printed in batches across days shows what is still left to run.
alter table public.work_orders add column if not exists qty               integer;
alter table public.work_orders add column if not exists printed_qty       integer not null default 0;
-- Bump a job to the top of the print queue.
alter table public.work_orders add column if not exists priority          boolean not null default false;
alter table public.work_orders drop constraint if exists work_orders_qty_chk;
alter table public.work_orders add  constraint work_orders_qty_chk
  check (qty is null or qty >= 0);
alter table public.work_orders drop constraint if exists work_orders_printed_qty_chk;
alter table public.work_orders add  constraint work_orders_printed_qty_chk
  check (printed_qty >= 0);
-- Reprints (a redo tally) and the post-print pickup step (migration 032).
alter table public.work_orders add column if not exists reprint_count       integer not null default 0;
alter table public.work_orders add column if not exists ready_for_pickup_at  timestamptz;
alter table public.work_orders drop constraint if exists work_orders_reprint_count_chk;
alter table public.work_orders add  constraint work_orders_reprint_count_chk check (reprint_count >= 0);
-- Soft-delete / Trash Bin (migration 035). A deleted job keeps its row (and its
-- Drive folder) until an admin restores it or permanently deletes it from the bin;
-- it is hidden from every normal view while deleted_at is set.
alter table public.work_orders add column if not exists deleted_at        timestamptz;
create index if not exists work_orders_deleted_idx on public.work_orders(deleted_at);
-- Post-print check (migration 036). The operator marks a job printed; reception
-- then checks it and either Releases it (released_at/by set = done) or Returns it
-- to the operator for a reprint (printed_at cleared, reprint tally bumped).
alter table public.work_orders add column if not exists released_at       timestamptz;
alter table public.work_orders add column if not exists released_by       uuid references public.profiles(id) on delete set null;
-- Customer contact (migration 038). Who the job is for, so reception can call
-- them for pickup and reports can group by client. Optional per job.
alter table public.work_orders add column if not exists client_name       text;
alter table public.work_orders add column if not exists client_phone      text;
-- Every file attached to the job (migration 042), as [{"url": …, "name": …}].
-- file_link stays the main print file; this holds it and any others (front/back,
-- sizes, proofs) so the ticket can show them all.
alter table public.work_orders add column if not exists attachments       jsonb not null default '[]'::jsonb;
-- What the job is, line by line (migration 046), as [{"name": …, "qty": n}].
-- The total quantity (qty) is the sum; the description stays as optional notes.
alter table public.work_orders add column if not exists items             jsonb not null default '[]'::jsonb;
-- The press side (migration 048):
--  • pages printed per item, in the same order as items (the total, printed_qty,
--    is kept as their sum);
--  • a problem the operator reported — what kind, a note, who and when;
--  • why reception returned a print, shown to the operator until it is reprinted.
alter table public.work_orders add column if not exists printed_items     jsonb not null default '[]'::jsonb;
alter table public.work_orders add column if not exists print_problem     text;
alter table public.work_orders add column if not exists print_problem_note text;
alter table public.work_orders add column if not exists print_problem_at  timestamptz;
alter table public.work_orders add column if not exists print_problem_by  uuid references public.profiles(id) on delete set null;
alter table public.work_orders add column if not exists return_note       text;
-- A note from reception / admin for the operator (049) — e.g. what to print
-- when the task has no file.
alter table public.work_orders add column if not exists operator_note     text;
alter table public.profiles    add column if not exists site              work_site;
alter table public.profiles    add column if not exists deactivated_at    timestamptz;
alter table public.profiles    add column if not exists username          text;
-- One username per staff account (owners with a real email have none).
create unique index if not exists profiles_username_key
  on public.profiles (lower(username)) where username is not null;

-- Also refresh the file-link URL check and the generated status column, which
-- an ALTER cannot change in place: drop and recreate so a re-run always lands
-- the current definition.
alter table public.work_orders drop constraint if exists work_orders_file_link_url;
alter table public.work_orders add  constraint work_orders_file_link_url
  check (file_link is null or file_link ~* '^https?://.+');
-- Attachments: a list of at most 30, each with a web link (migration 042).
-- Items: a list of at most 50, each with a name and a whole-number quantity (046).
alter table public.work_orders drop constraint if exists work_orders_items_chk;
alter table public.work_orders add  constraint work_orders_items_chk
  check (jsonb_typeof(items) = 'array'
         and jsonb_array_length(items) <= 50
         and not jsonb_path_exists(items,
               '$[*] ? (@.type() != "object" || !exists(@.name) || @.name.type() != "string" || (exists(@.qty) && @.qty.type() != "number" && @.qty.type() != "null"))'));
alter table public.work_orders drop constraint if exists work_orders_printed_items_chk;
alter table public.work_orders add  constraint work_orders_printed_items_chk
  check (jsonb_typeof(printed_items) = 'array'
         and jsonb_array_length(printed_items) <= 50
         and not jsonb_path_exists(printed_items, '$[*] ? (@.type() != "number" || @ < 0)'));
alter table public.work_orders drop constraint if exists work_orders_print_problem_chk;
alter table public.work_orders add  constraint work_orders_print_problem_chk
  check ((print_problem is null or print_problem in ('wrong_item', 'broken_print', 'printer_down', 'other'))
         and char_length(coalesce(print_problem_note, '')) <= 500
         and char_length(coalesce(return_note, '')) <= 500
         and char_length(coalesce(operator_note, '')) <= 1000);
alter table public.work_orders drop constraint if exists work_orders_attachments_chk;
alter table public.work_orders add  constraint work_orders_attachments_chk
  check (jsonb_typeof(attachments) = 'array'
         and jsonb_array_length(attachments) <= 30
         and not jsonb_path_exists(attachments,
               '$[*] ? (@.type() != "object" || !exists(@.url) || @.url.type() != "string" || !(@.url like_regex "^https?://.+" flag "i"))'));

alter table public.work_orders drop constraint if exists work_orders_stage_chk;
alter table public.work_orders add  constraint work_orders_stage_chk
  check (stage in ('todo', 'in_progress'));

drop index if exists work_orders_status_idx;
alter table public.work_orders drop column if exists status;
alter table public.work_orders add column status text generated always as (
  case
    when printed_at is not null    then 'printed'
    when queued_at is not null      then 'awaiting_print'   -- an admin sent it to print
    when date_finished is not null then 'finished'         -- artist done, awaiting admin review
    else coalesce(stage, 'todo')                           -- the team's manual stage: To Do / In progress
  end
) stored;

create index if not exists work_orders_artist_idx on public.work_orders(artist_id);
create index if not exists work_orders_status_idx on public.work_orders(status);
create index if not exists work_orders_given_idx  on public.work_orders(date_given desc);

-- ---------------------------------------------------------------
-- 3. Per-work-order chat
-- ---------------------------------------------------------------
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  body          text not null check (length(trim(body)) > 0),
  created_at    timestamptz not null default now()
);

create index if not exists messages_wo_idx on public.messages(work_order_id, created_at);

-- Drives the unread badge in the glance table.
create table if not exists public.message_reads (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (user_id, work_order_id)
);

-- ---------------------------------------------------------------
-- 4. Business rules enforced in the database, not just the UI
-- ---------------------------------------------------------------

-- PRD §6 step 2: "The Finished date auto-fills if left blank."
-- PRD §6 step 6: ticking printed stamps the date and the person automatically.
-- PRD §5: the printed check-off is restricted to the operator view — enforced
--         here so it holds even if someone calls the API directly.
create or replace function public.work_orders_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    -- printer, other. The operator (or an admin) reports it — the press stops, so
    -- a running timer pauses. The operator, reception or an admin clears it.
    if new.print_problem is distinct from old.print_problem then
      if new.print_problem is not null then
        if caller not in ('operator', 'admin') then
          raise exception 'Only a printer operator can report a problem';
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
      -- Marking a job printed is operators/admin only. Reception may CLEAR it
      -- (returning a printed job to the operator for a reprint); the field-lock
      -- further down still stops reception from touching the job's content.
      if new.printed_at is not null then
        if caller not in ('operator', 'admin') then
          raise exception 'Only a printer operator can mark a work order as printed';
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
        new.printed_by := auth.uid();
        select site into my_site from public.profiles where id = auth.uid();
        new.printed_site := my_site;
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

    -- Reception can assign the operator and set priority, but only an operator
    -- (or admin) runs the print — its state, timer and pieces (046). Clearing
    -- them, as a Return for reprint does, is still allowed.
    if caller = 'receptionist' and (
         (new.print_state      is distinct from old.print_state      and new.print_state      is not null) or
         (new.print_eta        is distinct from old.print_eta        and new.print_eta        is not null) or
         (new.print_pause_left is distinct from old.print_pause_left and new.print_pause_left is not null) or
         (new.printed_qty      is distinct from old.printed_qty      and new.printed_qty      <> 0) or
         (new.printed_items    is distinct from old.printed_items    and new.printed_items    <> '[]'::jsonb)
       ) then
      raise exception 'Only a printer operator can run the print';
    end if;

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
end $$;

drop trigger if exists work_orders_guard_trg on public.work_orders;
create trigger work_orders_guard_trg
  before insert or update on public.work_orders
  for each row execute function public.work_orders_guard();

-- ---------------------------------------------------------------
-- 5. Row level security
--    Small trusted shop: everyone signed in reads everything.
--    Writing is what gets scoped.
-- ---------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.work_orders   enable row level security;
alter table public.messages      enable row level security;
alter table public.message_reads enable row level security;

-- Profiles
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.current_user_role() = 'admin')
  with check (id = auth.uid() or public.current_user_role() = 'admin');

-- A person may keep their own profile (their name, the must-change-password
-- flag), but must never change their own ROLE or ACTIVE flag — that would be
-- self-promotion to admin. RLS WITH CHECK cannot compare against the old row,
-- so this is enforced in a trigger. The service_role (the admin-users Edge
-- Function) has no auth.uid() and is trusted, so it is not restricted.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and public.current_user_role() is distinct from 'admin' then
    if new.role is distinct from old.role then
      raise exception 'You cannot change your own role';
    end if;
    if new.active is distinct from old.active then
      raise exception 'You cannot change your own active status';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- Deactivation is a countdown: stamp when someone is switched off, clear it
-- when they are switched back on. A stamped account is purged 3 days later.
create or replace function public.stamp_deactivated()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.active is distinct from old.active then
    new.deactivated_at := case when new.active then null else now() end;
  end if;
  return new;
end $$;

drop trigger if exists stamp_deactivated_trg on public.profiles;
create trigger stamp_deactivated_trg
  before update of active on public.profiles
  for each row execute function public.stamp_deactivated();

-- Permanently remove accounts that have been deactivated for more than 3 days.
-- Deleting the auth user cascades to the profile; work orders keep their rows
-- (the artist link just goes null). Runs from a daily pg_cron job (below); can
-- also be called by hand. security definer so it can reach auth.users.
create or replace function public.purge_deactivated_accounts()
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  removed integer;
begin
  with gone as (
    delete from auth.users u
    using public.profiles p
    where p.id = u.id
      and p.active = false
      and p.deactivated_at is not null
      and p.deactivated_at < now() - interval '3 days'
    returning u.id
  )
  select count(*) into removed from gone;
  return removed;
end $$;

-- Schedule the purge once a day (03:10 UTC). pg_cron lives in this database on
-- Supabase; the guarded block keeps the schema safe to re-run.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule('purge-deactivated')
      where exists (select 1 from cron.job where jobname = 'purge-deactivated');
    perform cron.schedule('purge-deactivated', '10 3 * * *',
      $cron$ select public.purge_deactivated_accounts(); $cron$);
  end if;
exception when others then
  -- pg_cron may be unavailable locally; the app works without the auto-purge.
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;

-- Work orders
drop policy if exists work_orders_read on public.work_orders;
create policy work_orders_read on public.work_orders
  for select to authenticated using (true);

-- Reception/admin open jobs for anyone; an artist can also open a task, but
-- only one assigned to themselves (they then drive it through To Do / In
-- progress — the same rows their update policy already lets them edit).
drop policy if exists work_orders_insert on public.work_orders;
create policy work_orders_insert on public.work_orders
  for insert to authenticated
  with check (
    public.current_user_role() in ('receptionist', 'admin')
    or (public.current_user_role() = 'artist' and artist_id = auth.uid())
  );

-- Artists edit their own jobs; reception/admin edit any; operators need
-- update rights for the printed check-off (the trigger above is what stops
-- an artist from using this to tick printed).
drop policy if exists work_orders_update on public.work_orders;
create policy work_orders_update on public.work_orders
  for update to authenticated
  using (
    public.current_user_role() in ('receptionist', 'admin', 'operator')
    or artist_id = auth.uid()
  )
  with check (
    public.current_user_role() in ('receptionist', 'admin', 'operator')
    or artist_id = auth.uid()
  );

drop policy if exists work_orders_delete on public.work_orders;
create policy work_orders_delete on public.work_orders
  for delete to authenticated using (public.current_user_role() = 'admin');

-- Chat
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages
  for select to authenticated using (true);

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated with check (author_id = auth.uid());

-- Messages are part of the audit trail — nobody edits history.
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated using (public.current_user_role() = 'admin');

-- Read receipts are private to each person
drop policy if exists reads_own on public.message_reads;
create policy reads_own on public.message_reads
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------
-- 6. Storage bucket for approved-file screenshots
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('previews', 'previews', false, 5242880,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists previews_read on storage.objects;
create policy previews_read on storage.objects
  for select to authenticated using (bucket_id = 'previews');

drop policy if exists previews_write on storage.objects;
create policy previews_write on storage.objects
  for insert to authenticated with check (bucket_id = 'previews');

drop policy if exists previews_update on storage.objects;
create policy previews_update on storage.objects
  for update to authenticated using (bucket_id = 'previews');

-- ---------------------------------------------------------------
-- 6b. Explicit Data API privileges
--     Stated here rather than relying on the project's "automatically expose
--     new tables" setting, so the schema works whether that is on or off.
--     These are table privileges only; RLS above still decides which ROWS
--     each person sees. Nothing is granted to anon: every policy in this file
--     is `to authenticated`, so signing in is required to touch anything.
-- ---------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.work_orders   to authenticated;
grant select, insert, update, delete on public.messages      to authenticated;
grant select, insert, update, delete on public.message_reads to authenticated;
grant select, update                 on public.profiles      to authenticated;

grant execute on function public.current_user_role() to authenticated;

-- ---------------------------------------------------------------
-- 6d. Direct messages — one-to-one chat, the "Chats" tab. Separate from the
--     per-work-order Comments; reached from a floating tab, tied to no job.
-- ---------------------------------------------------------------
create table if not exists public.direct_messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (length(trim(body)) > 0),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check (sender_id <> recipient_id)
);
create index if not exists dm_sender_idx    on public.direct_messages(sender_id, created_at);
create index if not exists dm_recipient_idx on public.direct_messages(recipient_id, created_at);

alter table public.direct_messages enable row level security;
drop policy if exists dm_read on public.direct_messages;
create policy dm_read on public.direct_messages
  for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists dm_insert on public.direct_messages;
create policy dm_insert on public.direct_messages
  for insert to authenticated with check (sender_id = auth.uid());
drop policy if exists dm_mark_read on public.direct_messages;
create policy dm_mark_read on public.direct_messages
  for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
drop policy if exists dm_delete on public.direct_messages;
create policy dm_delete on public.direct_messages
  for delete to authenticated
  using (sender_id = auth.uid() or public.current_user_role() = 'admin');
grant select, insert, update, delete on public.direct_messages to authenticated;

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

-- Update the kind check in place for a database created before mentions (029),
-- the printed notice (036), the finished notice (037) or the problem notice
-- (048); the inline check above only lands on a fresh install.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add  constraint notifications_kind_check
  check (kind in ('assign', 'message', 'mention', 'comment', 'printed', 'finished', 'queued', 'problem'));

alter table public.notifications enable row level security;
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());
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
create trigger notify_operator_assignment_trg
  after update of operator_id on public.work_orders
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

-- ---------------------------------------------------------------
-- 6c. Shop settings (the shared Drive folder)
--     Kept in the database so moving from a personal Google account to the
--     company one is an edit on the Settings screen, not a redeploy.
-- ---------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated using (true);

drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

grant select, insert, update, delete on public.app_settings to authenticated;

create or replace function public.app_settings_touch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists app_settings_touch_trg on public.app_settings;
create trigger app_settings_touch_trg
  before insert or update on public.app_settings
  for each row execute function public.app_settings_touch();

insert into public.app_settings (key, value) values
  ('drive_folder_url', null),
  ('drive_account_note', null)
on conflict (key) do nothing;

-- ---------------------------------------------------------------
-- 6f. Web push subscriptions (migration 033) — one row per device a person
--     turned push on for. RLS scopes it to the owner; the push-send Edge
--     Function reads it with the service_role key to deliver while the app is
--     closed. The VAPID public key lives in app_settings (set in Settings).
-- ---------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;
insert into public.app_settings (key, value) values ('vapid_public_key', null)
on conflict (key) do nothing;

-- ---------------------------------------------------------------
-- 6h. Work order drafts (migration 046) — a New work order form that was not
--     saved yet (closed, refreshed, lost connection). Private to its author,
--     on any of their devices; removed once the work order is created.
-- ---------------------------------------------------------------
create table if not exists public.work_order_drafts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_drafts_size_chk check (pg_column_size(data) < 100000)
);
create index if not exists work_order_drafts_user_idx on public.work_order_drafts(user_id, updated_at desc);
alter table public.work_order_drafts enable row level security;
drop policy if exists work_order_drafts_own on public.work_order_drafts;
create policy work_order_drafts_own on public.work_order_drafts
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.work_order_drafts to authenticated;

-- ---------------------------------------------------------------
-- 6g. Trusted devices (migration 034) — a device a person chose to "trust for
--     30 days" so two-factor (TOTP) isn't re-prompted every login. The TOTP
--     factors themselves live in auth.mfa_factors (Supabase MFA). RLS scopes
--     rows to their owner.
-- ---------------------------------------------------------------
create table if not exists public.trusted_devices (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  token_hash   text not null,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  primary key (user_id, token_hash)
);
create index if not exists trusted_devices_user_idx on public.trusted_devices(user_id);
alter table public.trusted_devices enable row level security;
drop policy if exists trusted_devices_own on public.trusted_devices;
create policy trusted_devices_own on public.trusted_devices
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.trusted_devices to authenticated;

-- ---------------------------------------------------------------
-- 7. Realtime — the live shared view and the operator's queue screen
-- ---------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.work_orders;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.app_settings;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.direct_messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- 8. Chat — conversations (1:1 and groups), messages, reactions
--    Membership scoped: a conversation is private to its members.
--    See migration-027 for the one-time backfill of direct_messages.
-- ---------------------------------------------------------------
create table if not exists public.chat_conversations (
  id              uuid primary key default gen_random_uuid(),
  title           text,
  is_group        boolean not null default false,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  added_at        timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members(user_id);
create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null check (length(trim(body)) > 0),
  created_at      timestamptz not null default now()
);
create index if not exists chat_messages_conv_idx on public.chat_messages(conversation_id, created_at);
create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists chat_reactions_msg_idx on public.chat_reactions(message_id);

create or replace function public.chat_is_member(conv uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.chat_members where conversation_id = conv and user_id = auth.uid());
$$;
create or replace function public.chat_is_member_of_message(msg uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.chat_messages cm
    join public.chat_members mm on mm.conversation_id = cm.conversation_id
    where cm.id = msg and mm.user_id = auth.uid());
$$;
create or replace function public.chat_touch_conversation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.chat_conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists chat_touch_conversation_trg on public.chat_messages;
create trigger chat_touch_conversation_trg after insert on public.chat_messages
  for each row execute function public.chat_touch_conversation();
create or replace function public.chat_start(other uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); conv uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if other = me then raise exception 'Cannot start a chat with yourself'; end if;
  select c.id into conv from public.chat_conversations c
   where c.is_group = false
     and exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = me)
     and exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = other)
     and (select count(*) from public.chat_members m where m.conversation_id = c.id) = 2
   limit 1;
  if conv is null then
    insert into public.chat_conversations (is_group, created_by) values (false, me) returning id into conv;
    insert into public.chat_members (conversation_id, user_id) values (conv, me), (conv, other);
  end if;
  return conv;
end $$;
create or replace function public.chat_create_group(p_title text, member_ids uuid[])
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); conv uuid; uid uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  insert into public.chat_conversations (title, is_group, created_by)
    values (nullif(btrim(p_title), ''), true, me) returning id into conv;
  insert into public.chat_members (conversation_id, user_id) values (conv, me) on conflict do nothing;
  if member_ids is not null then
    foreach uid in array member_ids loop
      if uid is not null and uid <> me then
        insert into public.chat_members (conversation_id, user_id) values (conv, uid) on conflict do nothing;
      end if;
    end loop;
  end if;
  return conv;
end $$;
create or replace function public.chat_add_members(conv uuid, member_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid;
begin
  if not public.chat_is_member(conv) then raise exception 'Not a member of this chat'; end if;
  if member_ids is not null then
    foreach uid in array member_ids loop
      if uid is not null then
        insert into public.chat_members (conversation_id, user_id) values (conv, uid) on conflict do nothing;
      end if;
    end loop;
  end if;
end $$;

alter table public.chat_conversations enable row level security;
alter table public.chat_members       enable row level security;
alter table public.chat_messages      enable row level security;
alter table public.chat_reactions     enable row level security;
drop policy if exists chat_conv_read on public.chat_conversations;
create policy chat_conv_read on public.chat_conversations
  for select to authenticated using (public.chat_is_member(id) or created_by = auth.uid());
drop policy if exists chat_conv_update on public.chat_conversations;
create policy chat_conv_update on public.chat_conversations
  for update to authenticated using (public.chat_is_member(id)) with check (public.chat_is_member(id));
drop policy if exists chat_members_read on public.chat_members;
create policy chat_members_read on public.chat_members
  for select to authenticated using (public.chat_is_member(conversation_id));
drop policy if exists chat_members_self on public.chat_members;
create policy chat_members_self on public.chat_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists chat_members_leave on public.chat_members;
create policy chat_members_leave on public.chat_members
  for delete to authenticated using (user_id = auth.uid());
drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages
  for select to authenticated using (public.chat_is_member(conversation_id));
drop policy if exists chat_messages_send on public.chat_messages;
create policy chat_messages_send on public.chat_messages
  for insert to authenticated with check (sender_id = auth.uid() and public.chat_is_member(conversation_id));
drop policy if exists chat_reactions_read on public.chat_reactions;
create policy chat_reactions_read on public.chat_reactions
  for select to authenticated using (public.chat_is_member_of_message(message_id));
drop policy if exists chat_reactions_add on public.chat_reactions;
create policy chat_reactions_add on public.chat_reactions
  for insert to authenticated with check (user_id = auth.uid() and public.chat_is_member_of_message(message_id));
drop policy if exists chat_reactions_del on public.chat_reactions;
create policy chat_reactions_del on public.chat_reactions
  for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.chat_conversations to authenticated;
grant select, insert, update, delete on public.chat_members       to authenticated;
grant select, insert, update, delete on public.chat_messages      to authenticated;
grant select, insert, update, delete on public.chat_reactions     to authenticated;
grant execute on function public.chat_is_member(uuid)            to authenticated;
grant execute on function public.chat_is_member_of_message(uuid) to authenticated;
grant execute on function public.chat_start(uuid)                to authenticated;
grant execute on function public.chat_create_group(text, uuid[]) to authenticated;
grant execute on function public.chat_add_members(uuid, uuid[])  to authenticated;

-- Remove a person from a group (migration 030). Base RLS only lets someone
-- leave (delete their own row); removing another needs this security-definer
-- RPC. Any member may remove someone, mirroring chat_add_members.
create or replace function public.chat_remove_member(conv uuid, target uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.chat_is_member(conv) then raise exception 'Not a member of this chat'; end if;
  delete from public.chat_members where conversation_id = conv and user_id = target;
end $$;
grant execute on function public.chat_remove_member(uuid, uuid) to authenticated;

-- Delete a group chat (migration 044): only the person who made it, and only
-- once everyone else has been removed — so nobody loses a conversation they are
-- still in. Its messages and reactions go with it (cascade), and so do the
-- chat notices that pointed at it, so none of them opens a chat that is gone.
create or replace function public.chat_delete_group(conv uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  c  public.chat_conversations;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into c from public.chat_conversations where id = conv;
  if not found or not c.is_group then raise exception 'Group chat not found'; end if;
  if c.created_by is distinct from me then
    raise exception 'Only the person who made this group can delete it';
  end if;
  if exists (select 1 from public.chat_members m where m.conversation_id = conv and m.user_id <> me) then
    raise exception 'Remove everyone else from the group first';
  end if;
  delete from public.notifications where ref_id = conv and kind in ('message', 'mention');
  delete from public.chat_conversations where id = conv;
end $$;

-- Remove a chat nobody else can use any more (migration 044): everyone else in
-- it has a deleted or deactivated account — e.g. a one-to-one chat with someone
-- who left. Any member still in it may remove it; its messages and chat
-- notices go with it.
create or replace function public.chat_delete_orphan(conv uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.chat_is_member(conv) then raise exception 'Not a member of this chat'; end if;
  if exists (select 1 from public.chat_members m join public.profiles p on p.id = m.user_id
             where m.conversation_id = conv and m.user_id <> me and p.active) then
    raise exception 'Someone in this chat still has an active account';
  end if;
  delete from public.notifications where ref_id = conv and kind in ('message', 'mention');
  delete from public.chat_conversations where id = conv;
end $$;
do $$ begin alter publication supabase_realtime add table public.chat_conversations; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.chat_members;       exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.chat_messages;      exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.chat_reactions;     exception when duplicate_object then null; end $$;

-- Chat message notifications (bell) — one per other member. A member tagged
-- with @[Name](uuid) in the body gets the stronger 'mention' notice instead of
-- the ordinary 'message' one, so nobody is pinged twice (migration 029). The
-- strict uuid shape keeps the ::uuid cast from throwing on a typed lookalike.
create or replace function public.chat_notify()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sender_name text;
  conv_title  text;
  conv_group  boolean;
  mentioned   uuid[];
begin
  select full_name into sender_name from public.profiles where id = new.sender_id;
  select title, is_group into conv_title, conv_group from public.chat_conversations where id = new.conversation_id;

  select array_agg(distinct (x.arr)[1]::uuid) into mentioned
  from regexp_matches(
    new.body,
    '@\[[^\]]+\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)',
    'g'
  ) as x(arr);
  mentioned := coalesce(mentioned, '{}');

  -- Tagged members: "mentioned you".
  insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
  select m.user_id, 'mention',
    coalesce(sender_name, 'Someone') || ' mentioned you'
      || case when conv_group then ' in ' || coalesce(conv_title, 'a group chat') else '' end,
    new.body, new.conversation_id, new.sender_id
  from public.chat_members m
  where m.conversation_id = new.conversation_id
    and m.user_id <> new.sender_id
    and m.user_id = any(mentioned);

  -- Everyone else: "sent a message".
  insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
  select m.user_id, 'message',
    coalesce(sender_name, 'Someone')
      || case when conv_group then ' in ' || coalesce(conv_title, 'a group chat') else '' end
      || ' sent a message',
    new.body, new.conversation_id, new.sender_id
  from public.chat_members m
  where m.conversation_id = new.conversation_id
    and m.user_id <> new.sender_id
    and not (m.user_id = any(mentioned));

  return new;
end $$;
drop trigger if exists chat_notify_trg on public.chat_messages;
create trigger chat_notify_trg after insert on public.chat_messages
  for each row execute function public.chat_notify();

-- Per-work-order comment mentions (migration 029): @[Name](uuid) in a comment
-- notifies the tagged person, routed to that ticket. The thread has no other
-- notifications, so this is purely additive.
create or replace function public.notify_comment_mention()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  author_name text;
  wo          text;
  mentioned   uuid[];
begin
  select array_agg(distinct (x.arr)[1]::uuid) into mentioned
  from regexp_matches(
    new.body,
    '@\[[^\]]+\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)',
    'g'
  ) as x(arr);
  if mentioned is null then return new; end if;

  select full_name into author_name from public.profiles where id = new.author_id;
  select wo_number into wo from public.work_orders where id = new.work_order_id;

  insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
  select distinct uid, 'comment',
    coalesce(author_name, 'Someone') || ' mentioned you on ' || coalesce(wo, 'a work order'),
    new.body, new.work_order_id, new.author_id
  from unnest(mentioned) as uid
  where uid <> new.author_id;

  return new;
end $$;
drop trigger if exists notify_comment_mention_trg on public.messages;
create trigger notify_comment_mention_trg after insert on public.messages
  for each row execute function public.notify_comment_mention();

-- ---------------------------------------------------------------
-- 9. Who may call the database's own functions (migration 041)
--    Postgres — and Supabase's default privileges — let everyone call a new
--    function, even signed-out visitors through the public API key. Every
--    function here runs with its owner's rights (SECURITY DEFINER), so each
--    gets exactly the callers it needs, re-applied on every run of this file:
--      • nobody signed out may call any of them;
--      • trigger functions can't be called directly at all — triggers still
--        fire (firing a trigger doesn't check EXECUTE);
--      • the account purge runs only from its nightly pg_cron job (as postgres);
--      • signed-in people keep the permission checks the row rules call and
--        the chat actions the app calls.
-- ---------------------------------------------------------------
revoke execute on function
  public.app_settings_touch(), public.chat_notify(), public.chat_touch_conversation(),
  public.handle_new_user(), public.notify_assignment(), public.notify_comment_mention(),
  public.notify_finished(), public.notify_message(), public.notify_printed(),
  public.notify_queued(), public.notify_problem(), public.notify_operator_assignment(),
  public.profiles_guard(), public.stamp_deactivated(),
  public.work_orders_guard(), public.purge_deactivated_accounts()
  from public, anon, authenticated;

-- Called inside the row-level-security policies, which run as the signed-in person.
revoke execute on function
  public.current_user_role(), public.chat_is_member(uuid), public.chat_is_member_of_message(uuid)
  from public, anon;
grant execute on function
  public.current_user_role(), public.chat_is_member(uuid), public.chat_is_member_of_message(uuid)
  to authenticated;

-- Chat actions the app calls (each checks sign-in / membership itself).
revoke execute on function
  public.chat_start(uuid), public.chat_create_group(text, uuid[]),
  public.chat_add_members(uuid, uuid[]), public.chat_remove_member(uuid, uuid),
  public.chat_delete_group(uuid), public.chat_delete_orphan(uuid)
  from public, anon;
grant execute on function
  public.chat_start(uuid), public.chat_create_group(text, uuid[]),
  public.chat_add_members(uuid, uuid[]), public.chat_remove_member(uuid, uuid),
  public.chat_delete_group(uuid), public.chat_delete_orphan(uuid)
  to authenticated;

-- Supabase's own "enable RLS on new tables" event trigger (created by the
-- platform, pinned to pg_catalog) — not callable directly by anyone either.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
