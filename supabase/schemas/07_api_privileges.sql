-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

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
