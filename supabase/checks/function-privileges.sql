-- Read-only check: who can call each database function, and its search_path.
-- Paste into the Supabase SQL editor after migration 041 (or any schema.sql
-- run). Every row should read OK. Changes nothing.
with expected(fn, anon_ok, signed_in_ok, why) as (values
  -- Called inside row-level-security policies (they run as the signed-in person).
  ('public.current_user_role()',                  false, true,  'RLS helper'),
  ('public.chat_is_member(uuid)',                 false, true,  'RLS helper'),
  ('public.chat_is_member_of_message(uuid)',      false, true,  'RLS helper'),
  -- Chat actions the app calls.
  ('public.chat_start(uuid)',                     false, true,  'chat action'),
  ('public.chat_create_group(text,uuid[])',       false, true,  'chat action'),
  ('public.chat_add_members(uuid,uuid[])',        false, true,  'chat action'),
  ('public.chat_remove_member(uuid,uuid)',        false, true,  'chat action'),
  ('public.chat_delete_group(uuid)',              false, true,  'chat action'),
  ('public.chat_delete_orphan(uuid)',             false, true,  'chat action'),
  -- Triggers (fire automatically; never called directly).
  ('public.app_settings_touch()',                 false, false, 'trigger'),
  ('public.chat_notify()',                        false, false, 'trigger'),
  ('public.chat_touch_conversation()',            false, false, 'trigger'),
  ('public.handle_new_user()',                    false, false, 'trigger'),
  ('public.notify_assignment()',                  false, false, 'trigger'),
  ('public.notify_comment_mention()',             false, false, 'trigger'),
  ('public.notify_finished()',                    false, false, 'trigger'),
  ('public.notify_message()',                     false, false, 'trigger'),
  ('public.notify_printed()',                     false, false, 'trigger'),
  ('public.notify_queued()',                      false, false, 'trigger'),
  ('public.profiles_guard()',                     false, false, 'trigger'),
  ('public.stamp_deactivated()',                  false, false, 'trigger'),
  ('public.work_orders_guard()',                  false, false, 'trigger'),
  ('public.drop_removed_file_credits()',          false, false, 'trigger'),
  ('public.rls_auto_enable()',                    false, false, 'Supabase event trigger'),
  -- File approval + artist file-credits + report archive actions the app calls.
  ('public.log_file_credit(uuid,text)',                       false, true,  'credit action'),
  ('public.revoke_file_credit(uuid,text)',                    false, true,  'credit action'),
  ('public.open_report_period(text,text,date,date,jsonb)',    false, true,  'report action'),
  ('public.finalize_report_period(text,text)',                false, true,  'report action'),
  ('public.set_report_period_drive_link(text,text,text)',     false, true,  'report action'),
  -- Nightly pg_cron job only.
  ('public.purge_deactivated_accounts()',         false, false, 'cron job'),
  ('public.process_report_periods()',             false, false, 'cron job')
)
select e.fn, e.why,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as signed_out_can_call,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as signed_in_can_call,
       array_to_string(p.proconfig, ', ')                        as settings,
       case when has_function_privilege('anon', p.oid, 'EXECUTE') = e.anon_ok
             and has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.signed_in_ok
             and p.proconfig::text like '%search_path=%'
            then 'OK' else 'CHECK' end                            as result
from expected e
join pg_proc p on p.oid = to_regprocedure(e.fn)
order by result desc, e.why, e.fn;
