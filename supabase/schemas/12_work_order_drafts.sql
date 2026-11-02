-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

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
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.work_order_drafts to authenticated;
