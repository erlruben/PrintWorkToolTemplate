-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

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
create index if not exists messages_author_id_idx on public.messages (author_id);
create index if not exists message_reads_work_order_id_idx on public.message_reads (work_order_id);

-- Drives the unread badge in the glance table.
create table if not exists public.message_reads (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (user_id, work_order_id)
);
