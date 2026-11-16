-- ServePoint base schema. Run this first in the Supabase SQL Editor, then run
-- artisan-private-details.sql to add private contact, notification, and payment tables.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'artisan', 'admin')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  trade text,
  area text,
  rating numeric(3,2) not null default 5.00 check (rating between 0 and 5),
  jobs integer not null default 0 check (jobs >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid references public.profiles(id) on delete set null,
  artisan_id uuid references public.profiles(id) on delete set null,
  service text not null,
  description text,
  area text not null,
  slot text,
  date date,
  total numeric(10,2) not null check (total >= 0),
  service_amount numeric(10,2) check (service_amount is null or service_amount >= 0),
  transport_amount numeric(10,2) check (transport_amount is null or transport_amount >= 0),
  discount_amount numeric(10,2) check (discount_amount is null or discount_amount >= 0),
  payment_reference text check (payment_reference is null or char_length(payment_reference) <= 120),
  method text,
  status text not null default 'open',
  tech text,
  prog numeric(4,3) check (prog is null or prog between 0 and 1),
  offroute boolean not null default false,
  tech_rating numeric(3,2),
  tech_jobs integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.applications (
  id bigint generated always as identity primary key,
  booking_id text not null references public.bookings(id) on delete cascade,
  artisan_id uuid not null references public.profiles(id) on delete cascade,
  artisan_name text not null check (char_length(btrim(artisan_name)) between 1 and 120),
  trade text,
  rating numeric(3,2) not null default 5.00 check (rating between 0 and 5),
  jobs integer not null default 0 check (jobs >= 0),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (booking_id, artisan_id)
);

create index if not exists bookings_owner_created_idx
  on public.bookings (owner_id, created_at desc);
create index if not exists bookings_customer_created_idx
  on public.bookings (customer_id, created_at desc);
create index if not exists bookings_open_service_created_idx
  on public.bookings (service, created_at desc) where status = 'open';
create index if not exists bookings_artisan_status_idx
  on public.bookings (artisan_id, status, created_at desc);
create index if not exists applications_booking_created_idx
  on public.applications (booking_id, created_at);
create index if not exists applications_artisan_created_idx
  on public.applications (artisan_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.applications enable row level security;

revoke all on public.profiles, public.bookings, public.applications from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, role, name, trade, area, rating, jobs) on public.profiles to authenticated;
grant update (name, trade, area) on public.profiles to authenticated;
grant select, insert, update on public.bookings to authenticated;
grant select, insert, update on public.applications to authenticated;
grant usage, select on sequence public.applications_id_seq to authenticated;
grant select, insert, update on public.profiles, public.bookings, public.applications to service_role;
grant usage, select on sequence public.applications_id_seq to service_role;

drop policy if exists profiles_authenticated_directory on public.profiles;
create policy profiles_authenticated_directory
  on public.profiles for select to authenticated
  using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles for insert to authenticated
  with check (id = auth.uid() and role in ('customer', 'artisan'));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists bookings_participant_or_matching_artisan_select on public.bookings;
create policy bookings_participant_or_matching_artisan_select
  on public.bookings for select to authenticated
  using (
    owner_id = auth.uid()
    or customer_id = auth.uid()
    or artisan_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or (
          status = 'open'
          and p.role = 'artisan'
          and lower(btrim(coalesce(p.trade, ''))) = lower(btrim(coalesce(service, '')))
        ))
    )
  );

drop policy if exists bookings_insert_owner on public.bookings;
create policy bookings_insert_owner
  on public.bookings for insert to authenticated
  with check (owner_id = auth.uid() and (customer_id is null or customer_id = auth.uid()));

drop policy if exists bookings_update_owner on public.bookings;
create policy bookings_update_owner
  on public.bookings for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and (customer_id is null or customer_id = auth.uid()));

drop policy if exists applications_participant_select on public.applications;
create policy applications_participant_select
  on public.applications for select to authenticated
  using (
    artisan_id = auth.uid()
    or exists (
      select 1 from public.bookings b
      where b.id = applications.booking_id
        and (b.owner_id = auth.uid() or b.customer_id = auth.uid())
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists applications_matching_artisan_insert on public.applications;
create policy applications_matching_artisan_insert
  on public.applications for insert to authenticated
  with check (
    artisan_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.profiles p
      join public.bookings b on b.id = applications.booking_id
      where p.id = auth.uid()
        and p.role = 'artisan'
        and p.trade = applications.trade
        and p.name = applications.artisan_name
        and p.rating = applications.rating
        and p.jobs = applications.jobs
        and p.trade = b.service
        and b.status = 'open'
    )
  );

drop policy if exists applications_customer_decision_update on public.applications;
create policy applications_customer_decision_update
  on public.applications for update to authenticated
  using (
    status = 'pending'
    and exists (
      select 1 from public.bookings b
      where b.id = applications.booking_id
        and (b.owner_id = auth.uid() or b.customer_id = auth.uid())
        and b.status = 'open'
    )
  )
  with check (
    status in ('accepted', 'declined')
    and exists (
      select 1 from public.bookings b
      where b.id = applications.booking_id
        and (b.owner_id = auth.uid() or b.customer_id = auth.uid())
    )
  );
