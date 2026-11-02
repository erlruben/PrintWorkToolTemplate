-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

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

-- One policy per action (advisor fix, 2026-10-05).
drop policy if exists app_settings_write on public.app_settings;
drop policy if exists app_settings_insert on public.app_settings;
drop policy if exists app_settings_update on public.app_settings;
drop policy if exists app_settings_delete on public.app_settings;
create policy app_settings_insert on public.app_settings
  for insert to authenticated with check ((select public.current_user_role()) = 'admin');
create policy app_settings_update on public.app_settings
  for update to authenticated
  using ((select public.current_user_role()) = 'admin')
  with check ((select public.current_user_role()) = 'admin');
create policy app_settings_delete on public.app_settings
  for delete to authenticated using ((select public.current_user_role()) = 'admin');
create index if not exists app_settings_updated_by_idx on public.app_settings (updated_by);

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
