-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

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
-- The operator picked ahead to print it, with the printing area (2026-10-20);
-- becomes operator_id when the job is sent to print.
alter table public.work_orders add column if not exists planned_operator_id uuid references public.profiles(id) on delete set null;
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
-- A task's own extra Items columns (migration 20261010210000_item_columns), in
-- order, as [{"key": …, "label": …}]. An item's values sit under its "extra".
alter table public.work_orders add column if not exists item_columns      jsonb not null default '[]'::jsonb;
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
-- The day a job was FIRST finished, kept even through a later Send back
-- (migration 20261012230000_first_finished_credit) — date_finished itself
-- gets cleared by Send back, so the Monthly Report reads this instead for an
-- artist's credit. sent_back_count is a revisions tally, same migration.
alter table public.work_orders add column if not exists first_finished_on date;
alter table public.work_orders add column if not exists sent_back_count   integer not null default 0;
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
               '$[*] ? (@.type() != "object" || !exists(@.name) || @.name.type() != "string" || (exists(@.qty) && @.qty.type() != "number" && @.qty.type() != "null") || (exists(@.per_sheet) && @.per_sheet.type() != "number" && @.per_sheet.type() != "null") || (exists(@.per_sheet) && @.per_sheet.type() == "number" && @.per_sheet < 1))'));
-- items[].per_sheet (20261027100000): how many fit on one printed sheet; unset = one per sheet.
-- Item columns: at most 6, each with a key and a label.
alter table public.work_orders drop constraint if exists work_orders_item_columns_chk;
alter table public.work_orders add  constraint work_orders_item_columns_chk
  check (jsonb_typeof(item_columns) = 'array'
         and jsonb_array_length(item_columns) <= 6
         and not jsonb_path_exists(item_columns,
               '$[*] ? (@.type() != "object" || !exists(@.key) || @.key.type() != "string" || !exists(@.label) || @.label.type() != "string")'));
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
-- An index on every foreign key (advisor fix, 2026-10-05).
create index if not exists work_orders_created_by_idx       on public.work_orders (created_by);
create index if not exists work_orders_operator_id_idx      on public.work_orders (operator_id);
create index if not exists work_orders_planned_operator_id_idx on public.work_orders (planned_operator_id);
create index if not exists work_orders_print_problem_by_idx on public.work_orders (print_problem_by);
create index if not exists work_orders_printed_by_idx       on public.work_orders (printed_by);
create index if not exists work_orders_released_by_idx      on public.work_orders (released_by);

-- "Waiting for client approval" (migration 20261013090000_client_wait): since when,
-- and the day it was first marked (the artist's work was done by then).
alter table public.work_orders
  add column if not exists client_wait_since    timestamptz,
  add column if not exists client_wait_first_on date;
