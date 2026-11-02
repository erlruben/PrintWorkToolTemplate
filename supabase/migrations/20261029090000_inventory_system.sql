-- PrintFlow inventory: location balances, an immutable movement ledger,
-- role-checked updates, work-order consumption and low-stock notifications.

create table if not exists public.inventory_items (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(btrim(name)) between 1 and 120),
  category              text not null default 'General' check (char_length(btrim(category)) between 1 and 60),
  sku                   text,
  unit                  text not null check (char_length(btrim(unit)) between 1 and 24),
  low_stock_threshold   numeric(14,3) not null default 0 check (low_stock_threshold >= 0),
  active                boolean not null default true,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists inventory_items_sku_lower_idx
  on public.inventory_items (lower(sku)) where sku is not null;

create table if not exists public.inventory_stock (
  item_id     uuid not null references public.inventory_items(id) on delete restrict,
  site        public.work_site not null,
  quantity    numeric(14,3) not null default 0 check (quantity >= 0),
  updated_at  timestamptz not null default now(),
  primary key (item_id, site)
);

create table if not exists public.inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.inventory_items(id) on delete restrict,
  site            public.work_site not null,
  movement_type   text not null check (movement_type in ('receipt', 'adjustment_in', 'adjustment_out', 'usage')),
  quantity_delta  numeric(14,3) not null check (quantity_delta <> 0),
  work_order_id   uuid references public.work_orders(id) on delete set null,
  note            text check (char_length(coalesce(note, '')) <= 500),
  actor_id        uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint inventory_movement_direction_chk check (
    (movement_type in ('receipt', 'adjustment_in') and quantity_delta > 0)
    or (movement_type in ('adjustment_out', 'usage') and quantity_delta < 0)
  ),
  constraint inventory_usage_work_order_chk check (
    (movement_type = 'usage' and work_order_id is not null)
    or (movement_type <> 'usage' and work_order_id is null)
  )
);
create index if not exists inventory_movements_item_at_idx
  on public.inventory_movements (item_id, created_at desc);
create index if not exists inventory_movements_work_order_idx
  on public.inventory_movements (work_order_id) where work_order_id is not null;

alter table public.inventory_items enable row level security;
alter table public.inventory_stock enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists inventory_items_read on public.inventory_items;
create policy inventory_items_read on public.inventory_items
  for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists inventory_stock_read on public.inventory_stock;
create policy inventory_stock_read on public.inventory_stock
  for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists inventory_movements_read on public.inventory_movements;
create policy inventory_movements_read on public.inventory_movements
  for select to authenticated using ((select auth.uid()) is not null);

revoke all on public.inventory_items, public.inventory_stock, public.inventory_movements
  from anon, authenticated;
grant select on public.inventory_items, public.inventory_stock, public.inventory_movements
  to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.inventory_items;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.inventory_stock;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.inventory_movements;
exception when duplicate_object then null; end $$;

create or replace function public.save_inventory_item(
  p_id uuid,
  p_name text,
  p_category text,
  p_sku text,
  p_unit text,
  p_low_stock_threshold numeric,
  p_active boolean
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  caller text := (select public.current_user_role())::text;
  saved_id uuid;
  sku_value text := nullif(btrim(coalesce(p_sku, '')), '');
begin
  if me is null or caller is null or caller not in ('admin', 'receptionist') then
    raise exception 'Only admins and receptionists can manage inventory items';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Enter an item name (up to 120 characters)';
  end if;
  if p_category is null or char_length(btrim(p_category)) not between 1 and 60 then
    raise exception 'Enter a category (up to 60 characters)';
  end if;
  if p_unit is null or char_length(btrim(p_unit)) not between 1 and 24 then
    raise exception 'Enter a stock unit (up to 24 characters)';
  end if;
  if char_length(coalesce(sku_value, '')) > 80 then
    raise exception 'Keep the SKU under 80 characters';
  end if;
  if p_low_stock_threshold is null or p_low_stock_threshold < 0 then
    raise exception 'The low-stock threshold cannot be negative';
  end if;

  if p_id is null then
    insert into public.inventory_items
      (name, category, sku, unit, low_stock_threshold, active, created_by)
    values
      (btrim(p_name), btrim(p_category), sku_value, btrim(p_unit), p_low_stock_threshold, coalesce(p_active, true), me)
    returning id into saved_id;

    insert into public.inventory_stock (item_id, site)
    values (saved_id, 'office'), (saved_id, 'production');
  else
    update public.inventory_items
       set name = btrim(p_name),
           category = btrim(p_category),
           sku = sku_value,
           unit = btrim(p_unit),
           low_stock_threshold = p_low_stock_threshold,
           active = coalesce(p_active, true),
           updated_at = now()
     where id = p_id
     returning id into saved_id;
    if not found then
      raise exception 'Inventory item not found';
    end if;
  end if;
  return saved_id;
exception
  when unique_violation then
    raise exception 'That SKU is already used by another inventory item';
end $$;
revoke execute on function public.save_inventory_item(uuid, text, text, text, text, numeric, boolean)
  from public, anon;
grant execute on function public.save_inventory_item(uuid, text, text, text, text, numeric, boolean)
  to authenticated;

create or replace function public.record_inventory_movement(
  p_item_id uuid,
  p_site public.work_site,
  p_movement_type text,
  p_quantity numeric,
  p_work_order_id uuid default null,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  caller text := (select public.current_user_role())::text;
  own_site public.work_site;
  qty_before numeric(14,3);
  qty_after numeric(14,3);
  delta numeric(14,3);
  threshold numeric(14,3);
  item_name text;
  item_unit text;
  movement_id uuid;
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
  area_name text := case p_site when 'office' then 'Office' when 'production' then 'Production' end;
begin
  if me is null or caller is null or caller not in ('admin', 'receptionist', 'operator') then
    raise exception 'You do not have permission to record inventory movements';
  end if;
  if p_site is null then
    raise exception 'Choose an inventory location';
  end if;
  if p_movement_type is null or p_movement_type not in ('receipt', 'adjustment_in', 'adjustment_out', 'usage') then
    raise exception 'Choose a valid inventory movement';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 999999999 then
    raise exception 'Enter a quantity greater than zero';
  end if;
  if char_length(coalesce(note_value, '')) > 500 then
    raise exception 'Keep the note under 500 characters';
  end if;
  if caller = 'operator' then
    if p_movement_type <> 'usage' then
      raise exception 'Operators can only record material used for a work order';
    end if;
    select site into own_site from public.profiles where id = me and active;
    if own_site is null or own_site is distinct from p_site then
      raise exception 'You can only record usage for your assigned printing area';
    end if;
  end if;
  if (p_movement_type = 'usage' and p_work_order_id is null)
     or (p_movement_type <> 'usage' and p_work_order_id is not null) then
    raise exception 'Work-order usage must be linked to a work order';
  end if;
  if p_movement_type = 'usage' and not exists (
    select 1 from public.work_orders where id = p_work_order_id and deleted_at is null
  ) then
    raise exception 'Work order not found or it is in the Trash Bin';
  end if;

  select i.name, i.unit, i.low_stock_threshold
    into item_name, item_unit, threshold
    from public.inventory_items i
   where i.id = p_item_id and i.active;
  if not found then
    raise exception 'Inventory item not found or inactive';
  end if;

  select s.quantity into qty_before
    from public.inventory_stock s
   where s.item_id = p_item_id and s.site = p_site
   for update;
  if not found then
    raise exception 'No stock balance exists for this item and location';
  end if;

  delta := case
    when p_movement_type in ('receipt', 'adjustment_in') then p_quantity
    else -p_quantity
  end;
  qty_after := qty_before + delta;
  if qty_after < 0 then
    raise exception 'Not enough stock. Available: % %', qty_before, item_unit;
  end if;

  update public.inventory_stock
     set quantity = qty_after, updated_at = now()
   where item_id = p_item_id and site = p_site;

  insert into public.inventory_movements
    (item_id, site, movement_type, quantity_delta, work_order_id, note, actor_id)
  values
    (p_item_id, p_site, p_movement_type, delta, p_work_order_id, note_value, me)
  returning id into movement_id;

  if threshold > 0 and qty_before > threshold and qty_after <= threshold then
    insert into public.notifications (user_id, kind, title, body, ref_id, actor_id)
    select p.id, 'low_stock',
      item_name || ' is low at ' || area_name,
      'Only ' || qty_after::text || ' ' || item_unit || ' remain. Reorder threshold: ' || threshold::text || ' ' || item_unit || '.',
      p_item_id, me
      from public.profiles p
     where p.active
       and p.role::text in ('admin', 'moderator', 'receptionist', 'developer', 'support')
       and p.id <> me;
  end if;

  return movement_id;
end $$;
revoke execute on function public.record_inventory_movement(uuid, public.work_site, text, numeric, uuid, text)
  from public, anon;
grant execute on function public.record_inventory_movement(uuid, public.work_site, text, numeric, uuid, text)
  to authenticated;
