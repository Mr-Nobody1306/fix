-- Run after supabase.sql and artisan-private-details.sql.
-- Accepted applications assign the booking atomically. Live location stores
-- one latest point per active job and is available only through the server.

drop policy if exists bookings_matching_artisan_select on public.bookings;
drop policy if exists bookings_skill_scoped_visibility on public.bookings;
drop function if exists public.can_view_servepoint_booking(uuid, uuid, text);
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
create policy bookings_matching_artisan_select
  on public.bookings for select to authenticated
  using (public.can_view_servepoint_booking(customer_id, owner_id, artisan_id, service));
create policy bookings_skill_scoped_visibility
  on public.bookings as restrictive for select to authenticated
  using (public.can_view_servepoint_booking(customer_id, owner_id, artisan_id, service));
revoke update on public.applications from authenticated;
grant update (status) on public.applications to authenticated;

drop policy if exists artisan_private_details_accepted_customer_select on public.artisan_private_details;
create policy artisan_private_details_accepted_customer_select
  on public.artisan_private_details for select to authenticated
  using (
    exists (
      select 1
      from public.applications a
      join public.bookings b on b.id = a.booking_id
      where a.artisan_id = artisan_private_details.artisan_id
        and a.status = 'accepted'
        and (b.customer_id = auth.uid() or b.owner_id = auth.uid())
    )
  );

drop policy if exists applications_customer_decision_update on public.applications;
create policy applications_customer_decision_update
  on public.applications as restrictive for update to authenticated
  using (
    status = 'pending'
    and exists (
      select 1 from public.bookings b
      where b.id = applications.booking_id
        and (b.customer_id = auth.uid() or b.owner_id = auth.uid())
        and b.status = 'open'
    )
  )
  with check (
    status in ('accepted', 'declined')
    and exists (
      select 1 from public.bookings b
      where b.id = applications.booking_id
        and (b.customer_id = auth.uid() or b.owner_id = auth.uid())
    )
    and (
      status <> 'accepted'
      or exists (
        select 1 from public.profiles p
        where p.id = applications.artisan_id
          and p.is_suspended = false
      )
    )
  );

create or replace function public.assign_accepted_servepoint_booking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'accepted' and old.status is distinct from new.status then
    update public.bookings
    set artisan_id = new.artisan_id,
        tech = new.artisan_name,
        tech_rating = new.rating,
        tech_jobs = new.jobs,
        status = 'enroute',
        prog = 0.06,
        updated_at = now()
    where id = new.booking_id
      and status = 'open'
      and artisan_id is null;

    if not found then
      raise exception 'booking_no_longer_open';
    end if;

    update public.applications
    set status = 'declined'
    where booking_id = new.booking_id
      and id <> new.id
      and status = 'pending';
  end if;
  return new;
end;
$$;
revoke all on function public.assign_accepted_servepoint_booking() from public, anon, authenticated;
drop trigger if exists servepoint_application_assign_booking on public.applications;
create trigger servepoint_application_assign_booking
  after update of status on public.applications
  for each row execute function public.assign_accepted_servepoint_booking();

create or replace function public.guard_servepoint_booking_client_changes()
returns trigger
language plpgsql
set search_path = public, auth, pg_temp
as $$
begin
  if coalesce(auth.role(), '') = 'service_role'
    or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.artisan_id is not null then
      raise exception 'booking_assignment_is_server_managed';
    end if;
    return new;
  end if;

  if new.artisan_id is distinct from old.artisan_id then
    raise exception 'booking_assignment_is_server_managed';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'cancelled'
      and (auth.uid() = old.owner_id or auth.uid() = old.customer_id)
      and old.status not in ('completed', 'cancelled', 'paid') then
      return new;
    end if;
    if new.status = 'completed'
      and new.method = 'Cash to Artisan'
      and old.status in ('arrived', 'working')
      and (auth.uid() = old.owner_id or auth.uid() = old.customer_id) then
      return new;
    end if;
    raise exception 'booking_status_is_server_managed';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_servepoint_booking_client_changes() from public, anon, authenticated;
drop trigger if exists servepoint_guard_booking_client_changes on public.bookings;
create trigger servepoint_guard_booking_client_changes
  before insert or update on public.bookings
  for each row execute function public.guard_servepoint_booking_client_changes();

create table if not exists public.booking_artisan_locations (
  booking_id text primary key references public.bookings(id) on delete cascade,
  artisan_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or accuracy_m between 0 and 10000),
  updated_at timestamptz not null default now()
);
alter table public.booking_artisan_locations enable row level security;
revoke all on public.booking_artisan_locations from anon, authenticated;
grant all on public.booking_artisan_locations to service_role;

create or replace function public.set_servepoint_artisan_location(
  p_booking_id text,
  p_artisan_id uuid,
  p_sharing boolean,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.bookings%rowtype;
  saved public.booking_artisan_locations%rowtype;
begin
  select * into target
  from public.bookings
  where id = p_booking_id
    and artisan_id = p_artisan_id
    and status in ('enroute', 'arrived', 'working')
  for update;
  if not found or not exists (
    select 1 from public.applications
    where booking_id = p_booking_id
      and artisan_id = p_artisan_id
      and status = 'accepted'
  ) then
    raise exception 'assigned_active_booking_required';
  end if;

  if not p_sharing then
    delete from public.booking_artisan_locations where booking_id = p_booking_id;
    return jsonb_build_object('sharing', false);
  end if;
  if p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or (p_accuracy_m is not null and p_accuracy_m not between 0 and 10000) then
    raise exception 'valid_location_required';
  end if;

  insert into public.booking_artisan_locations (
    booking_id, artisan_id, latitude, longitude, accuracy_m, updated_at
  ) values (
    p_booking_id, p_artisan_id, p_latitude, p_longitude, p_accuracy_m, now()
  )
  on conflict (booking_id) do update
  set artisan_id = excluded.artisan_id,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy_m = excluded.accuracy_m,
      updated_at = excluded.updated_at
  returning * into saved;
  return jsonb_build_object(
    'sharing', true,
    'location', jsonb_build_object(
      'latitude', saved.latitude,
      'longitude', saved.longitude,
      'accuracy_m', saved.accuracy_m,
      'updated_at', saved.updated_at
    )
  );
end;
$$;
revoke all on function public.set_servepoint_artisan_location(text, uuid, boolean, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.set_servepoint_artisan_location(text, uuid, boolean, double precision, double precision, double precision) to service_role;

create or replace function public.clear_servepoint_location_when_job_ends()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('completed', 'cancelled', 'paid') then
    delete from public.booking_artisan_locations where booking_id = new.id;
  elsif new.artisan_id is distinct from old.artisan_id then
    delete from public.booking_artisan_locations where booking_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_servepoint_location_when_job_ends() from public, anon, authenticated;
drop trigger if exists servepoint_clear_location_when_job_ends on public.bookings;
create trigger servepoint_clear_location_when_job_ends
  after update of status, artisan_id on public.bookings
  for each row execute function public.clear_servepoint_location_when_job_ends();
