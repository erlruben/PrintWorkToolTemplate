-- A file's Art done credit goes when the file leaves the task, 2026-10-22.
--
-- revoke_file_credit() is still called by the app after a file is removed,
-- but as a separate request: if the connection drops in between, the file is
-- gone and its credit stays. This trigger takes the credit back in the same
-- save that takes the file off the task, whichever screen or role does it.
-- Additive: one trigger function + one trigger; no table or data changes.
-- (Credits of a task in the Trash stop counting in the app instead — they
-- come back with the task if it is restored.)

create or replace function public.drop_removed_file_credits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.file_credit_events e
   where e.work_order_id = new.id
     and e.file_url is distinct from left(coalesce(new.file_link, ''), 2048)
     and not exists (
       select 1 from jsonb_array_elements(coalesce(new.attachments, '[]'::jsonb)) a
        where left(a->>'url', 2048) = e.file_url);
  return null;
end $$;
revoke execute on function public.drop_removed_file_credits() from public, anon, authenticated;

drop trigger if exists drop_removed_file_credits_trg on public.work_orders;
create trigger drop_removed_file_credits_trg
  after update of attachments, file_link on public.work_orders
  for each row
  when (old.attachments is distinct from new.attachments or old.file_link is distinct from new.file_link)
  execute function public.drop_removed_file_credits();
