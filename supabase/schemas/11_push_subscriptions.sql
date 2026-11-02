-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

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
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;
insert into public.app_settings (key, value) values ('vapid_public_key', null)
on conflict (key) do nothing;
