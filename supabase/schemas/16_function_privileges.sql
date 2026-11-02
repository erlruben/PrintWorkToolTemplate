-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

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
