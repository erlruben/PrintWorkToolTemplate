-- Moderator is an operational role below Admin. Admin-only policies remain
-- restricted to admin, developer, and support accounts.
alter type public.app_role add value if not exists 'moderator';

-- Normalize moderators to reception for database workflow authorization. This
-- grants the combined reception/artist/operator workflow surface without
-- granting admin-only account, settings, archive, or reporting privileges.
create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when role::text in ('developer', 'support') then 'admin'::public.app_role
    when role::text = 'moderator' then 'receptionist'::public.app_role
    else role
  end
  from public.profiles
  where id = auth.uid()
$$;
