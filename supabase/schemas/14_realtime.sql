-- Work Order Tracker — part of the database reference (supabase/schemas).
-- Changes go in a new file in supabase/migrations; keep this file in step.

-- ---------------------------------------------------------------
-- 7. Realtime — the live shared view and the operator's queue screen
-- ---------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.work_orders;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.app_settings;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.direct_messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
-- Staff status changes show for everyone at once (20261008120000_staff_status).
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
