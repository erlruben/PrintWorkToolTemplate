-- Recovery emails, 2026-10-12: only Support and the Tech Developer manage
-- other people's. The Admin role no longer can (2026-10-11: "admin roles
-- can't change emails for now"); until now only the screens hid it.
--
--  * Everyone still sees their own, and adds or changes their own through
--    set_my_recovery_email() with their current password (unchanged).
--  * Seeing, adding, changing or removing SOMEONE ELSE'S: Support and the
--    Tech Developer only (public.is_support_staff()), where it used to be
--    every admin-level role.
--
-- This replaces the four policies on public.account_recovery. No data is
-- changed or removed. To give the Admin role this back later, restore the
-- policies from migration 20261008190000_password_recovery_email.
drop policy if exists account_recovery_select on public.account_recovery;
create policy account_recovery_select on public.account_recovery
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_support_staff()));
drop policy if exists account_recovery_insert on public.account_recovery;
create policy account_recovery_insert on public.account_recovery
  for insert to authenticated
  with check ((select public.is_support_staff()));
drop policy if exists account_recovery_update on public.account_recovery;
create policy account_recovery_update on public.account_recovery
  for update to authenticated
  using ((select public.is_support_staff()))
  with check ((select public.is_support_staff()));
drop policy if exists account_recovery_delete on public.account_recovery;
create policy account_recovery_delete on public.account_recovery
  for delete to authenticated
  using ((select public.is_support_staff()));
