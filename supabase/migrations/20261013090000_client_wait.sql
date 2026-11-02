-- "Waiting for client approval", 2026-10-13 (the rest of the artist's complaint
-- that Fix 1, 20261012230000_first_finished_credit, began).
--  * client_wait_since: the job is waiting for the client's approval since
--    then. The artist's part is done, so the app does not count it as late.
--    Set and cleared by reception, an admin, or the job's own artist; it
--    clears itself when the job is sent to print, printed, or trashed.
--  * client_wait_first_on: the day it was FIRST marked. Set once and kept, so
--    the Monthly Report can credit the artist's work from that day even
--    though the job is not finished yet.
--  * The rules live in their own small trigger. The big work_orders_guard
--    function is not touched.
--
-- Additive only: two new empty columns, one function, one trigger. No
-- existing row is changed.
alter table public.work_orders
  add column if not exists client_wait_since    timestamptz,
  add column if not exists client_wait_first_on date;

create or replace function public.work_orders_client_wait()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  caller text := (select public.current_user_role())::text;
begin
  -- A new job is never waiting for the client yet.
  if tg_op = 'INSERT' then
    new.client_wait_since := null;
    new.client_wait_first_on := null;
    return new;
  end if;

  -- The "first marked" day is this trigger's own: nobody sets or clears it by hand.
  new.client_wait_first_on := old.client_wait_first_on;

  if new.client_wait_since is distinct from old.client_wait_since then
    -- Reception, an admin, or the job's own artist. (No signed-in person = the
    -- database owner doing maintenance, which is allowed.)
    if me is not null and not (caller in ('admin', 'receptionist') or (caller = 'artist' and old.artist_id = me)) then
      raise exception 'Only reception, an admin or the task''s artist can mark it as waiting for the client';
    end if;
    if new.client_wait_since is not null then
      if new.artist_id is null then
        raise exception 'Assign an artist before marking a task as waiting for the client';
      end if;
      if new.queued_at is not null or new.printed_at is not null then
        raise exception 'This job has already gone to print';
      end if;
      new.client_wait_since := now();                       -- the server's clock, not the device's
      if new.client_wait_first_on is null then
        new.client_wait_first_on := (now() at time zone 'Asia/Manila')::date;
      end if;
    end if;
  end if;

  -- Sent to print, printed, or moved to the Trash: it is no longer waiting for the client.
  if new.client_wait_since is not null
     and (new.queued_at is not null or new.printed_at is not null or new.deleted_at is not null) then
    new.client_wait_since := null;
  end if;
  return new;
end $$;
revoke execute on function public.work_orders_client_wait() from public, anon, authenticated;

drop trigger if exists work_orders_client_wait_trg on public.work_orders;
create trigger work_orders_client_wait_trg
  before insert or update on public.work_orders
  for each row execute function public.work_orders_client_wait();
