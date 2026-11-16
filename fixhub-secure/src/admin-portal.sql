-- Run after supabase.sql and artisan-private-details.sql on existing projects.
-- Admin actions are performed only by the server with its service-role key.
alter table public.profiles
  add column if not exists is_suspended boolean not null default false,
  add column if not exists suspension_reason text,
  add column if not exists suspended_at timestamptz;

drop policy if exists profiles_active_artisan_directory on public.profiles;
create policy profiles_active_artisan_directory
  on public.profiles as restrictive for select to authenticated
  using (id = auth.uid() or role <> 'artisan' or is_suspended = false);

create or replace function public.can_view_servepoint_booking(
  booking_customer_id uuid, booking_owner_id uuid, booking_artisan_id uuid, booking_service text
) returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select booking_customer_id = auth.uid()
    or booking_owner_id = auth.uid()
    or booking_artisan_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or (
          p.role = 'artisan'
          and p.is_suspended = false
          and lower(btrim(coalesce(p.trade, ''))) = lower(btrim(coalesce(booking_service, '')))
        ))
    );
$$;
revoke all on function public.can_view_servepoint_booking(uuid, uuid, uuid, text) from public;
grant execute on function public.can_view_servepoint_booking(uuid, uuid, uuid, text) to authenticated;

drop policy if exists applications_matching_trade_insert on public.applications;
create policy applications_matching_trade_insert
  on public.applications as restrictive for insert to authenticated
  with check (
    artisan_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      join public.bookings b on b.service = p.trade
      where p.id = auth.uid() and p.role = 'artisan'
        and p.is_suspended = false
        and p.trade = applications.trade and b.id = applications.booking_id and b.status = 'open'
    )
  );

drop policy if exists applications_customer_decision_update on public.applications;
create policy applications_customer_decision_update
  on public.applications as restrictive for update to authenticated
  using (
    status = 'pending'
    and exists (
      select 1 from public.bookings b
      where b.id = applications.booking_id and b.customer_id = auth.uid() and b.status = 'open'
    )
  )
  with check (
    status in ('accepted', 'declined')
    and exists (
      select 1 from public.bookings b
      where b.id = applications.booking_id and b.customer_id = auth.uid()
    )
    and (
      status <> 'accepted'
      or exists (
        select 1 from public.profiles p
        where p.id = applications.artisan_id and p.is_suspended = false
      )
    )
  );

create table if not exists public.admin_action_log (
  id bigint generated always as identity primary key,
  admin_email text not null,
  action text not null check (action in ('artisan_suspended', 'artisan_reinstated')),
  artisan_id uuid not null references public.profiles(id),
  reason text,
  created_at timestamptz not null default now()
);
alter table public.admin_action_log enable row level security;
revoke all on public.admin_action_log from anon, authenticated;
grant all on public.admin_action_log to service_role;
grant usage, select on sequence public.admin_action_log_id_seq to service_role;

create or replace function public.admin_portal_overview()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'artisans', jsonb_build_object(
      'total', (select count(*) from public.profiles where role = 'artisan'),
      'active', (select count(*) from public.profiles where role = 'artisan' and is_suspended = false),
      'suspended', (select count(*) from public.profiles where role = 'artisan' and is_suspended = true)
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
    'audit', coalesce((
      select jsonb_agg(to_jsonb(recent))
      from (
        select id, admin_email, action, artisan_id, reason, created_at
        from public.admin_action_log
        order by created_at desc, id desc
        limit 25
      ) recent
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.admin_portal_overview() from public, anon, authenticated;
grant execute on function public.admin_portal_overview() to service_role;

create or replace function public.prevent_client_artisan_suspension_changes()
returns trigger
language plpgsql
set search_path = public, auth, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and current_user not in ('postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      if new.is_suspended or new.suspension_reason is not null or new.suspended_at is not null then
        raise exception 'artisan_suspension_is_server_managed';
      end if;
    elsif new.is_suspended is distinct from old.is_suspended
      or new.suspension_reason is distinct from old.suspension_reason
      or new.suspended_at is distinct from old.suspended_at then
      raise exception 'artisan_suspension_is_server_managed';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_client_artisan_suspension_changes() from public, anon, authenticated;
drop trigger if exists profiles_prevent_client_suspension_changes on public.profiles;
create trigger profiles_prevent_client_suspension_changes
  before insert or update on public.profiles
  for each row execute function public.prevent_client_artisan_suspension_changes();

create or replace function public.admin_set_artisan_suspension(
  p_admin_email text,
  p_artisan_id uuid,
  p_suspended boolean,
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
  if p_admin_email is null or char_length(btrim(p_admin_email)) = 0 then
    raise exception 'admin_identity_required';
  end if;
  if p_suspended and (clean_reason is null or char_length(clean_reason) < 5 or char_length(clean_reason) > 500) then
    raise exception 'valid_suspension_reason_required';
  end if;

  select * into target
  from public.profiles
  where id = p_artisan_id and role = 'artisan'
  for update;
  if not found then
    return jsonb_build_object('error', 'artisan_not_found');
  end if;
  if target.is_suspended = p_suspended then
    return jsonb_build_object(
      'id', target.id,
      'is_suspended', target.is_suspended,
      'suspension_reason', target.suspension_reason,
      'suspended_at', target.suspended_at,
      'changed', false
    );
  end if;

  update public.profiles
  set is_suspended = p_suspended,
      suspension_reason = case when p_suspended then clean_reason else null end,
      suspended_at = case when p_suspended then now() else null end,
      updated_at = now()
  where id = p_artisan_id;

  if p_suspended then
    update public.applications
    set status = 'declined'
    where artisan_id = p_artisan_id and status = 'pending';
  end if;

  insert into public.admin_action_log (admin_email, action, artisan_id, reason)
  values (
    lower(btrim(p_admin_email)),
    case when p_suspended then 'artisan_suspended' else 'artisan_reinstated' end,
    p_artisan_id,
    clean_reason
  );

  return jsonb_build_object(
    'id', p_artisan_id,
    'is_suspended', p_suspended,
    'suspension_reason', case when p_suspended then clean_reason else null end,
    'suspended_at', case when p_suspended then now() else null end,
    'changed', true
  );
end;
$$;
revoke all on function public.admin_set_artisan_suspension(text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_set_artisan_suspension(text, uuid, boolean, text) to service_role;
