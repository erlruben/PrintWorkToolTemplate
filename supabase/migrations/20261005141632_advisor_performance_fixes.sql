-- Fixes from Supabase's own Security & Performance Advisor (splinter), run
-- against live on 2026-10-05: 0 errors, 0 security problems; these are the
-- performance warnings. Nobody can do anything new or less than before — the
-- rules say exactly the same, they are only evaluated faster.
--
-- 1. auth_rls_initplan (21 policies): auth.uid() and current_user_role() are
--    wrapped in (select …) so Postgres works them out once per query instead of
--    once per row (Supabase docs: 11 s → 10 ms on large tables).
-- 2. multiple_permissive_policies: app_settings had a read policy plus an
--    "all" write policy that also covered reads; the write policy is split into
--    insert / update / delete so each action has one policy.
-- 3. unindexed_foreign_keys (12): an index on each foreign key, so lookups and
--    account removals (which clear these links) never scan whole tables.
-- 4. storage previews_update gains the WITH CHECK it was missing, so an update
--    cannot move a file out of the previews bucket.
-- Not changed, on purpose: the 9 "authenticated can execute SECURITY DEFINER"
-- notes (chat actions and the role check the policies use — intended, each
-- checks membership / returns only the caller's own role) and the 2 "unused
-- index" notes (the table is still small; they are used as it grows).

-- 1. Policies: same rules, evaluated once per query.
alter policy chat_conv_read on public.chat_conversations
  using ((public.chat_is_member(id) OR (created_by = (select auth.uid()))));
alter policy chat_members_leave on public.chat_members
  using ((user_id = (select auth.uid())));
alter policy chat_members_self on public.chat_members
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy chat_messages_send on public.chat_messages
  with check (((sender_id = (select auth.uid())) AND public.chat_is_member(conversation_id)));
alter policy chat_reactions_add on public.chat_reactions
  with check (((user_id = (select auth.uid())) AND public.chat_is_member_of_message(message_id)));
alter policy chat_reactions_del on public.chat_reactions
  using ((user_id = (select auth.uid())));
alter policy dm_delete on public.direct_messages
  using (((sender_id = (select auth.uid())) OR ((select public.current_user_role()) = 'admin'::public.app_role)));
alter policy dm_insert on public.direct_messages
  with check ((sender_id = (select auth.uid())));
alter policy dm_mark_read on public.direct_messages
  using ((recipient_id = (select auth.uid())))
  with check ((recipient_id = (select auth.uid())));
alter policy dm_read on public.direct_messages
  using (((sender_id = (select auth.uid())) OR (recipient_id = (select auth.uid()))));
alter policy reads_own on public.message_reads
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy messages_delete on public.messages
  using (((select public.current_user_role()) = 'admin'::public.app_role));
alter policy messages_insert on public.messages
  with check ((author_id = (select auth.uid())));
alter policy notifications_delete on public.notifications
  using ((user_id = (select auth.uid())));
alter policy notifications_read on public.notifications
  using ((user_id = (select auth.uid())));
alter policy notifications_update on public.notifications
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy profiles_self_update on public.profiles
  using (((id = (select auth.uid())) OR ((select public.current_user_role()) = 'admin'::public.app_role)))
  with check (((id = (select auth.uid())) OR ((select public.current_user_role()) = 'admin'::public.app_role)));
alter policy push_subs_own on public.push_subscriptions
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy trusted_devices_own on public.trusted_devices
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy work_order_drafts_own on public.work_order_drafts
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy work_orders_delete on public.work_orders
  using (((select public.current_user_role()) = 'admin'::public.app_role));
alter policy work_orders_insert on public.work_orders
  with check ((((select public.current_user_role()) = ANY (ARRAY['receptionist'::public.app_role, 'admin'::public.app_role])) OR (((select public.current_user_role()) = 'artist'::public.app_role) AND (artist_id = (select auth.uid())))));
alter policy work_orders_update on public.work_orders
  using ((((select public.current_user_role()) = ANY (ARRAY['receptionist'::public.app_role, 'admin'::public.app_role, 'operator'::public.app_role])) OR (artist_id = (select auth.uid()))))
  with check ((((select public.current_user_role()) = ANY (ARRAY['receptionist'::public.app_role, 'admin'::public.app_role, 'operator'::public.app_role])) OR (artist_id = (select auth.uid()))));

-- 2. app_settings: one policy per action.
drop policy if exists app_settings_write on public.app_settings;
drop policy if exists app_settings_insert on public.app_settings;
drop policy if exists app_settings_update on public.app_settings;
drop policy if exists app_settings_delete on public.app_settings;
create policy app_settings_insert on public.app_settings
  for insert to authenticated with check ((select public.current_user_role()) = 'admin'::public.app_role);
create policy app_settings_update on public.app_settings
  for update to authenticated
  using ((select public.current_user_role()) = 'admin'::public.app_role)
  with check ((select public.current_user_role()) = 'admin'::public.app_role);
create policy app_settings_delete on public.app_settings
  for delete to authenticated using ((select public.current_user_role()) = 'admin'::public.app_role);

-- 3. Foreign-key indexes.
create index if not exists app_settings_updated_by_idx on public.app_settings (updated_by);
create index if not exists chat_conversations_created_by_idx on public.chat_conversations (created_by);
create index if not exists chat_messages_sender_id_idx on public.chat_messages (sender_id);
create index if not exists chat_reactions_user_id_idx on public.chat_reactions (user_id);
create index if not exists message_reads_work_order_id_idx on public.message_reads (work_order_id);
create index if not exists messages_author_id_idx on public.messages (author_id);
create index if not exists notifications_actor_id_idx on public.notifications (actor_id);
create index if not exists work_orders_created_by_idx on public.work_orders (created_by);
create index if not exists work_orders_operator_id_idx on public.work_orders (operator_id);
create index if not exists work_orders_print_problem_by_idx on public.work_orders (print_problem_by);
create index if not exists work_orders_printed_by_idx on public.work_orders (printed_by);
create index if not exists work_orders_released_by_idx on public.work_orders (released_by);

-- 4. Storage: an update keeps the file in the previews bucket.
alter policy previews_update on storage.objects
  using (bucket_id = 'previews'::text)
  with check (bucket_id = 'previews'::text);
