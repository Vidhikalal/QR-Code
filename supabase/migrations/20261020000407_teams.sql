-- SPEC §5.5 / F15 (v0.7): teams of at most 4 accepted hackers, each with at most one of the event's tracks.
-- Organizers open team forming and release the tracks (events flags); they can edit teams at any time.

alter table events
  add column teams_open boolean not null default false,
  add column tracks_released boolean not null default false;

create table tracks (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events on delete cascade,
  name       text not null check (length(name) between 1 and 100 and name = btrim(name)),
  created_at timestamptz not null default clock_timestamp(),  -- per row: tracks pasted together keep their order
  unique (id, event_id)
);
create unique index tracks_name on tracks (event_id, lower(name));

create table teams (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events on delete cascade,
  name       text not null check (length(name) between 1 and 60 and name = btrim(name)),
  join_code  text not null check (join_code ~ '^[A-HJ-NP-Z2-9]{8}$'),  -- not a secret (F15 DECISION)
  track_id   uuid,
  created_at timestamptz not null default now(),
  unique (id, event_id),
  unique (event_id, join_code),
  -- A track is always one of this event's; deleting it leaves the team without one.
  foreign key (track_id, event_id) references tracks (id, event_id) on delete set null (track_id)
);
create unique index teams_name on teams (event_id, lower(name));
create index teams_track on teams (track_id) where track_id is not null;

alter table participants
  add column team_id uuid,
  add column looking_for_team boolean not null default false,
  -- Same event only; deleting a team moves its members out.
  add constraint participants_team_fk foreign key (team_id, event_id) references teams (id, event_id) on delete set null (team_id);
create index participants_team on participants (team_id) where team_id is not null;

alter table tracks enable row level security;
alter table teams enable row level security;

-- At most 4 members, however someone is added (hacker functions or an organizer's direct update). Locking the
-- team row serializes joins, so parallel joins can't overfill it, and a join waits for a last leaver's delete.
create function public._participant_team() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.team_id is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.team_id is not distinct from old.team_id then return new; end if;
  end if;
  perform 1 from teams where id = new.team_id for update;
  if (select count(*) from participants where team_id = new.team_id and id <> new.id) >= 4 then
    raise exception 'team_full' using errcode = 'check_violation', constraint = 'team_size';
  end if;
  new.looking_for_team := false;  -- in a team now: out of the teammate directory
  return new;
end $$;
revoke all on function public._participant_team() from public, anon, authenticated;
create trigger participants_team before insert or update of team_id on participants
  for each row execute function public._participant_team();

-- The hacker functions below act only on the caller's own accepted, undeleted row (matched by verified email)
-- in an event that hasn't ended. Audit rows carry ids only: no team names or codes (I-11).

create function public.team_create(p_participant_id uuid, p_email text, p_user_id uuid, p_name text, p_code text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; ev events%rowtype; t uuid;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
  select * into ev from events where id = pa.event_id;
  if not ev.teams_open then return 'CLOSED'; end if;
  if pa.team_id is not null then return 'IN_A_TEAM'; end if;
  begin
    insert into teams (event_id, name, join_code) values (pa.event_id, btrim(p_name), p_code) returning id into t;
  exception when unique_violation then
    return 'NAME_TAKEN';  -- or, about once in 10^10 tries, a join code this event already has: try again
  end;
  update participants set team_id = t where id = pa.id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'team.create', t);
  return 'CREATED';
end $$;
revoke all on function public.team_create(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.team_create(uuid, text, uuid, text, text) to service_role;

-- By join code. p_team_id is for accepting an invite (S11b); without one it finds nothing.
create function public.team_join(p_participant_id uuid, p_email text, p_user_id uuid, p_code text default null, p_team_id uuid default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; ev events%rowtype; t uuid;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
  select * into ev from events where id = pa.event_id;
  if not ev.teams_open then return 'CLOSED'; end if;
  if pa.team_id is not null then return 'IN_A_TEAM'; end if;
  if p_team_id is null then
    select id into t from teams where event_id = pa.event_id and join_code = p_code;
  end if;
  if t is null then return 'BAD_CODE'; end if;
  begin
    update participants set team_id = t where id = pa.id;
  exception
    when check_violation then return 'TEAM_FULL';
    when foreign_key_violation then return 'BAD_CODE';  -- its last member left (and deleted it) while we waited
  end;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'team.join', t);
  return 'JOINED';
end $$;
revoke all on function public.team_join(uuid, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.team_join(uuid, text, uuid, text, uuid) to service_role;

-- The last one out deletes the team. The team row is locked first, so a join either lands before (and the
-- team stays) or waits and finds it gone (BAD_CODE); nobody ends up in a deleted team.
create function public.team_leave(p_participant_id uuid, p_email text, p_user_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; ev events%rowtype;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found or pa.team_id is null then return 'NOT_FOUND'; end if;
  select * into ev from events where id = pa.event_id;
  if not ev.teams_open then return 'CLOSED'; end if;
  perform 1 from teams where id = pa.team_id for update;
  update participants set team_id = null where id = pa.id;
  delete from teams where id = pa.team_id and not exists (select 1 from participants where team_id = pa.team_id);
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'team.leave', pa.team_id);
  return 'LEFT';
end $$;
revoke all on function public.team_leave(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.team_leave(uuid, text, uuid) to service_role;

-- Any member picks the team's track once organizers release them, even after forming closes.
create function public.team_set_track(p_participant_id uuid, p_email text, p_user_id uuid, p_track_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; ev events%rowtype;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found or pa.team_id is null then return 'NOT_FOUND'; end if;
  select * into ev from events where id = pa.event_id;
  if not ev.tracks_released then return 'NOT_RELEASED'; end if;
  begin
    update teams set track_id = p_track_id where id = pa.team_id;
  exception when foreign_key_violation then
    return 'NOT_FOUND';  -- another event's track
  end;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'team.track', pa.team_id);
  return 'SAVED';
end $$;
revoke all on function public.team_set_track(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.team_set_track(uuid, text, uuid, uuid) to service_role;

-- §5.1 tombstone, now also leaving their team. Same as 20261019214235 otherwise.
create or replace function public.delete_participant(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype;
begin
  select * into pa from participants where id = p_participant_id and event_id = p_event_id for update;
  if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if pa.deleted_at is not null then return jsonb_build_object('code', 'ALREADY_DELETED'); end if;
  update participants
     set deleted_at = now(), first_name = 'Deleted', last_name = '', email = 'deleted+' || id || '@invalid',
         search_text = '', dietary_notes = null, linkedin_url = null, photo_path = null, photo_updated_at = null,
         emergency_name = null, emergency_phone = null, emergency_relation = null,
         team_id = null, looking_for_team = false,
         updated_at = now()
   where id = pa.id;
  update passes set revoked_at = now(), revoke_reason = 'deleted' where participant_id = pa.id and revoked_at is null;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = pa.id and status in ('pending', 'sending');
  delete from badges where participant_id = pa.id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'participant.delete', pa.id);
  return jsonb_build_object('code', 'DELETED', 'photoPath', pa.photo_path);
end $$;
