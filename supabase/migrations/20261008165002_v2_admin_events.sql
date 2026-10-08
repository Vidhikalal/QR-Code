-- PLAN §6.2. Platform admins, event settings for v2, event creation from the dashboard.

create table platform_admins (
  email    text primary key check (email = lower(btrim(email))),
  user_id  uuid unique references auth.users on delete set null,  -- linked at first sign-in
  added_at timestamptz not null default now()
);

alter table events
  add column created_by                  uuid references auth.users,
  add column organizers_compete          boolean not null default false,          -- (?) Q1
  add column organizer_connection_bonus  int not null default 2 check (organizer_connection_bonus between 0 and 100),
  add column leaderboard_refresh_minutes int not null default 60 check (leaderboard_refresh_minutes in (0, 15, 30, 60)),
  add column leaderboard_frozen_at       timestamptz,
  add column badge_unlock_password       text check (length(badge_unlock_password) between 4 and 32),
  add column recap_message               text check (length(recap_message) <= 2000),  -- (?) Q5
  add column profile_retention_days      int not null default 30 check (profile_retention_days between 1 and 3650); -- (?) Q4

-- Called by the auth callback with the user's VERIFIED email, next to consume_staff_invites().
create or replace function public.consume_platform_admin(p_user_id uuid, p_email text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update platform_admins set user_id = p_user_id
   where email = lower(btrim(p_email)) and (user_id is null or user_id = p_user_id);
  return found;
end $$;

create or replace function public.is_platform_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from platform_admins where user_id = p_user_id)
$$;

-- One transaction: event + its single Door checkpoint (closed) + the creating admin as organizer.
create or replace function public.create_event(
  p_admin_id uuid, p_slug text, p_name text, p_venue text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_timezone text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  if not is_platform_admin(p_admin_id) then return jsonb_build_object('code', 'FORBIDDEN'); end if;
  begin
    perform now() at time zone p_timezone;          -- raises for an unknown IANA zone
  exception when invalid_parameter_value then
    return jsonb_build_object('code', 'INVALID_TIMEZONE');
  end;
  if p_ends_at <= p_starts_at then return jsonb_build_object('code', 'INVALID_DATES'); end if;
  begin
    insert into events (slug, name, venue, starts_at, ends_at, timezone, created_by)
    values (p_slug, p_name, p_venue, p_starts_at, p_ends_at, p_timezone, p_admin_id)
    returning id into new_id;
  exception when unique_violation then
    return jsonb_build_object('code', 'SLUG_TAKEN');
  end;
  insert into checkpoints (event_id, name, kind, requires_checkin, is_open, sort_order)
  values (new_id, 'Door', 'door', false, false, 0);
  insert into event_staff (event_id, user_id, role) values (new_id, p_admin_id, 'organizer');
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (new_id, p_admin_id, 'staff', 'event.create', new_id);
  return jsonb_build_object('code', 'CREATED', 'eventId', new_id);
end $$;

-- An admin opening an event they are not staff on gets an explicit "Join as organizer" button.
create or replace function public.join_event_as_admin(p_admin_id uuid, p_event_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_platform_admin(p_admin_id) then return 'FORBIDDEN'; end if;
  if not exists (select 1 from events where id = p_event_id) then return 'NOT_FOUND'; end if;
  insert into event_staff (event_id, user_id, role) values (p_event_id, p_admin_id, 'organizer')
  on conflict (event_id, user_id) do update set role = 'organizer';
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_admin_id, 'staff', 'event.admin_join', p_admin_id);
  return 'JOINED';
end $$;

-- Events list (PLAN §8.1): admins see every event; everyone else sees the events they staff.
create or replace function public.list_events_for(p_user_id uuid)
returns table (id uuid, slug text, name text, starts_at timestamptz, ends_at timestamptz, timezone text, my_role staff_role)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.slug, e.name, e.starts_at, e.ends_at, e.timezone, es.role
    from events e
    left join event_staff es on es.event_id = e.id and es.user_id = p_user_id
   where es.user_id is not null or is_platform_admin(p_user_id)
   order by e.starts_at desc, e.slug
$$;

do $$ declare f text; begin
  foreach f in array array[
    'consume_platform_admin(uuid,text)', 'is_platform_admin(uuid)',
    'create_event(uuid,text,text,text,timestamptz,timestamptz,text)',
    'join_event_as_admin(uuid,uuid)', 'list_events_for(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
alter table platform_admins enable row level security;

-- Added in V1 (not in the reference SQL): slugs that would shadow a route. /admin/new is a static
-- page and /api/admin/events/* is matched before /api/admin/[slug]/*. Mirrored by lib/events/slug.ts.
alter table events add constraint events_slug_not_reserved check (slug not in ('new', 'events'));
