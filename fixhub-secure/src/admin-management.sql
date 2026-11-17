-- Run after supabase.sql, artisan-private-details.sql, admin-portal.sql,
-- and live-tracking.sql. Admin writes go through the server service role.

create table if not exists public.service_catalog (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  starting_price numeric(10,2) not null check (starting_price >= 0),
  description text not null default '' check (char_length(description) <= 240),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists service_catalog_name_ci_unique
  on public.service_catalog (lower(name));
alter table public.service_catalog enable row level security;
revoke all on public.service_catalog from anon, authenticated;
grant select on public.service_catalog to authenticated;
grant all on public.service_catalog to service_role;
drop policy if exists service_catalog_active_read on public.service_catalog;
create policy service_catalog_active_read
  on public.service_catalog for select to authenticated
  using (active);

insert into public.service_catalog (id, name, starting_price, description)
values
  ('plumbing', 'Plumbing', 80, 'Leaks, pipes, tanks & fittings'),
  ('electrical', 'Electrical', 90, 'Wiring, sockets & faults'),
  ('cleaning', 'Deep Cleaning', 150, 'Homes, offices & move-out'),
  ('carpentry', 'Carpentry', 100, 'Doors, roofs & furniture'),
  ('hvac', 'HVAC', 120, 'AC install & servicing')
on conflict (id) do nothing;

drop policy if exists bookings_active_service_insert on public.bookings;
create policy bookings_active_service_insert
  on public.bookings as restrictive for insert to authenticated
  with check (exists (
    select 1 from public.service_catalog s
    where s.id = service and s.active
  ));
drop policy if exists bookings_active_service_discovery on public.bookings;
create policy bookings_active_service_discovery
  on public.bookings as restrictive for select to authenticated
  using (
    status <> 'open'
    or owner_id = auth.uid()
    or customer_id = auth.uid()
    or artisan_id = auth.uid()
    or exists (
      select 1 from public.service_catalog s
      where s.id = service and s.active
    )
  );
drop policy if exists applications_active_service_insert on public.applications;
create policy applications_active_service_insert
  on public.applications as restrictive for insert to authenticated
  with check (exists (
    select 1 from public.service_catalog s
    where s.id = trade and s.active
  ));

alter table public.profiles
  add column if not exists is_blocked boolean not null default false,
  add column if not exists block_reason text,
  add column if not exists blocked_at timestamptz;

create or replace function public.prevent_client_account_block_changes()
returns trigger
language plpgsql
set search_path = public, auth, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and current_user not in ('postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      if new.is_blocked or new.block_reason is not null or new.blocked_at is not null then
        raise exception 'account_blocking_is_server_managed';
      end if;
    elsif new.is_blocked is distinct from old.is_blocked
      or new.block_reason is distinct from old.block_reason
      or new.blocked_at is distinct from old.blocked_at then
      raise exception 'account_blocking_is_server_managed';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_client_account_block_changes() from public, anon, authenticated;
drop trigger if exists profiles_prevent_client_account_block_changes on public.profiles;
create trigger profiles_prevent_client_account_block_changes
  before insert or update on public.profiles
  for each row execute function public.prevent_client_account_block_changes();

create or replace function public.servepoint_account_is_active()
returns boolean
language sql stable security definer
set search_path = public, auth, pg_temp
as $$
  select not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_blocked
  );
$$;
revoke all on function public.servepoint_account_is_active() from public, anon;
grant execute on function public.servepoint_account_is_active() to authenticated;

drop policy if exists profiles_active_account_only on public.profiles;
create policy profiles_active_account_only
  on public.profiles as restrictive for all to authenticated
  using (public.servepoint_account_is_active())
  with check (public.servepoint_account_is_active());
drop policy if exists bookings_active_account_only on public.bookings;
create policy bookings_active_account_only
  on public.bookings as restrictive for all to authenticated
  using (public.servepoint_account_is_active())
  with check (public.servepoint_account_is_active());
drop policy if exists applications_active_account_only on public.applications;
create policy applications_active_account_only
  on public.applications as restrictive for all to authenticated
  using (public.servepoint_account_is_active())
  with check (public.servepoint_account_is_active());
drop policy if exists notifications_active_account_only on public.notifications;
create policy notifications_active_account_only
  on public.notifications as restrictive for all to authenticated
  using (public.servepoint_account_is_active())
  with check (public.servepoint_account_is_active());
drop policy if exists artisan_private_details_active_account_only on public.artisan_private_details;
create policy artisan_private_details_active_account_only
  on public.artisan_private_details as restrictive for all to authenticated
  using (public.servepoint_account_is_active())
  with check (public.servepoint_account_is_active());

create table if not exists public.admin_audit_events (
  id bigint generated always as identity primary key,
  admin_email text not null,
  action text not null,
  target_id text,
  target_label text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_events_created_idx
  on public.admin_audit_events (created_at desc, id desc);
alter table public.admin_audit_events enable row level security;
revoke all on public.admin_audit_events from anon, authenticated;
grant all on public.admin_audit_events to service_role;
grant usage, select on sequence public.admin_audit_events_id_seq to service_role;

alter table public.admin_action_log add column if not exists target_id text;
alter table public.admin_action_log add column if not exists target_label text;
update public.admin_action_log
set target_id = coalesce(target_id, artisan_id::text)
where target_id is null;
update public.admin_action_log a
set target_label = p.name
from public.profiles p
where a.artisan_id = p.id and a.target_label is null;
alter table public.admin_action_log alter column artisan_id drop not null;
alter table public.admin_action_log drop constraint if exists admin_action_log_artisan_id_fkey;
alter table public.admin_action_log
  add constraint admin_action_log_artisan_id_fkey
  foreign key (artisan_id) references public.profiles(id) on delete set null;

alter table public.bookings drop constraint if exists bookings_customer_id_fkey;
alter table public.bookings
  add constraint bookings_customer_id_fkey
  foreign key (customer_id) references public.profiles(id) on delete cascade;

create or replace function public.admin_set_account_block(
  p_admin_id uuid,
  p_admin_email text,
  p_target_id uuid,
  p_blocked boolean,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.profiles%rowtype;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_admin_id is null or p_admin_email is null or char_length(btrim(p_admin_email)) = 0 then
    raise exception 'admin_identity_required';
  end if;
  if p_target_id = p_admin_id then
    return jsonb_build_object('error', 'cannot_change_own_access');
  end if;
  if clean_reason is null or char_length(clean_reason) < 5 or char_length(clean_reason) > 500 then
    raise exception 'valid_reason_required';
  end if;

  select * into target from public.profiles where id = p_target_id for update;
  if not found then
    return jsonb_build_object('error', 'user_not_found');
  end if;
  if target.role = 'admin' then
    return jsonb_build_object('error', 'admin_account_protected');
  end if;
  if target.is_blocked = p_blocked then
    return jsonb_build_object(
      'id', target.id,
      'is_blocked', target.is_blocked,
      'block_reason', target.block_reason,
      'blocked_at', target.blocked_at,
      'changed', false
    );
  end if;

  update public.profiles
  set is_blocked = p_blocked,
      block_reason = case when p_blocked then clean_reason else null end,
      blocked_at = case when p_blocked then now() else null end,
      updated_at = now()
  where id = p_target_id;

  insert into public.admin_audit_events (
    admin_email, action, target_id, target_label, reason, details
  ) values (
    lower(btrim(p_admin_email)),
    case when p_blocked then 'user_blocked' else 'user_unblocked' end,
    p_target_id::text, target.name, clean_reason,
    jsonb_build_object('role', target.role)
  );

  return jsonb_build_object(
    'id', p_target_id,
    'is_blocked', p_blocked,
    'block_reason', case when p_blocked then clean_reason else null end,
    'blocked_at', case when p_blocked then now() else null end,
    'changed', true
  );
end;
$$;
revoke all on function public.admin_set_account_block(uuid, text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_set_account_block(uuid, text, uuid, boolean, text) to service_role;

create or replace function public.admin_create_service(
  p_admin_email text,
  p_service_id text,
  p_name text,
  p_starting_price numeric,
  p_description text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created public.service_catalog%rowtype;
begin
  if p_admin_email is null or char_length(btrim(p_admin_email)) = 0 then
    raise exception 'admin_identity_required';
  end if;
  if p_service_id is null or p_service_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_name is null or char_length(btrim(p_name)) not between 2 and 80
    or p_starting_price is null or p_starting_price < 0 or p_starting_price > 100000
    or char_length(coalesce(p_description, '')) > 240 then
    raise exception 'invalid_service';
  end if;

  begin
    insert into public.service_catalog (id, name, starting_price, description)
    values (p_service_id, btrim(p_name), p_starting_price, coalesce(p_description, ''))
    returning * into created;
  exception when unique_violation then
    return jsonb_build_object('error', 'service_exists');
  end;

  insert into public.admin_audit_events (
    admin_email, action, target_id, target_label, details
  ) values (
    lower(btrim(p_admin_email)), 'service_added', created.id, created.name,
    jsonb_build_object('startingPrice', created.starting_price, 'description', created.description)
  );
  return jsonb_build_object('service', to_jsonb(created));
end;
$$;
revoke all on function public.admin_create_service(text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_create_service(text, text, text, numeric, text) to service_role;

create or replace function public.admin_set_service_active(
  p_admin_email text,
  p_service_id text,
  p_active boolean,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  service_row public.service_catalog%rowtype;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_admin_email is null or char_length(btrim(p_admin_email)) = 0 then
    raise exception 'admin_identity_required';
  end if;
  if p_service_id is null or p_service_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or p_active is null then
    raise exception 'invalid_service';
  end if;
  if not p_active and (clean_reason is null or char_length(clean_reason) < 5 or char_length(clean_reason) > 500) then
    raise exception 'valid_reason_required';
  end if;

  select * into service_row from public.service_catalog where id = p_service_id for update;
  if not found then
    return jsonb_build_object('error', 'service_not_found');
  end if;
  if service_row.active = p_active then
    return jsonb_build_object('service', to_jsonb(service_row), 'changed', false);
  end if;

  update public.service_catalog
  set active = p_active, updated_at = now()
  where id = p_service_id
  returning * into service_row;

  insert into public.admin_audit_events (
    admin_email, action, target_id, target_label, reason, details
  ) values (
    lower(btrim(p_admin_email)),
    case when p_active then 'service_restored' else 'service_removed' end,
    service_row.id, service_row.name, clean_reason,
    jsonb_build_object('startingPrice', service_row.starting_price)
  );
  return jsonb_build_object('service', to_jsonb(service_row), 'changed', true);
end;
$$;
revoke all on function public.admin_set_service_active(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_set_service_active(text, text, boolean, text) to service_role;

create or replace function public.admin_portal_overview()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'blocked_users', (select count(*) from public.profiles where is_blocked),
    'artisans', jsonb_build_object(
      'total', (select count(*) from public.profiles where role = 'artisan'),
      'active', (select count(*) from public.profiles where role = 'artisan' and is_suspended = false and is_blocked = false),
      'suspended', (select count(*) from public.profiles where role = 'artisan' and is_suspended = true),
      'blocked', (select count(*) from public.profiles where role = 'artisan' and is_blocked = true)
    ),
    'services', jsonb_build_object(
      'total', (select count(*) from public.service_catalog),
      'active', (select count(*) from public.service_catalog where active),
      'inactive', (select count(*) from public.service_catalog where not active)
    ),
    'bookings', jsonb_build_object(
      'total', (select count(*) from public.bookings),
      'open', (select count(*) from public.bookings where status = 'open'),
      'active', (select count(*) from public.bookings where status in ('enroute', 'arrived', 'working')),
      'completed', (select count(*) from public.bookings where status = 'completed'),
      'cancelled', (select count(*) from public.bookings where status = 'cancelled')
    ),
    'payments', jsonb_build_object(
      'confirmed', (select count(*) from public.booking_payment_state where payment_status = 'confirmed'),
      'payouts_processing', (select count(*) from public.booking_payment_state where payout_status = 'processing'),
      'payouts_paid', (select count(*) from public.booking_payment_state where payout_status = 'paid')
    ),
    'top_services', coalesce((
      select jsonb_agg(to_jsonb(recent))
      from (
        select service, count(*) as bookings
        from public.bookings
        group by service
        order by bookings desc, service
        limit 10
      ) recent
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(recent))
      from (
        select id, admin_email, action, target_id, target_label, reason, details, created_at
        from (
          select id, admin_email, action, coalesce(target_id, artisan_id::text) as target_id,
            target_label, reason, '{}'::jsonb as details, created_at
          from public.admin_action_log
          union all
          select id, admin_email, action, target_id, target_label, reason, details, created_at
          from public.admin_audit_events
        ) all_events
        order by created_at desc, id desc
        limit 100
      ) recent
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.admin_portal_overview() from public, anon, authenticated;
grant execute on function public.admin_portal_overview() to service_role;
