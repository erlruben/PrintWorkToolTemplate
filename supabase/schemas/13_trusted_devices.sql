-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

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
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.trusted_devices to authenticated;
