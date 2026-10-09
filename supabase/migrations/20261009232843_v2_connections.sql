-- V6. Reference 07, connections part only, unchanged (points_as_of / leaderboard arrive with V7):
-- PLAN §6.7. Networking (mutual connections) and the two leaderboards.

create table connection_taps (
  event_id            uuid not null,
  from_participant_id uuid not null,
  to_participant_id   uuid not null,
  via_tag_id          uuid not null references tags,
  created_at          timestamptz not null default now(),
  primary key (from_participant_id, to_participant_id),
  check (from_participant_id <> to_participant_id),
  foreign key (from_participant_id, event_id) references participants (id, event_id),
  foreign key (to_participant_id, event_id)   references participants (id, event_id)
);
create index connection_taps_reverse on connection_taps (to_participant_id, from_participant_id);
create index connection_taps_event   on connection_taps (event_id, created_at);

create or replace function public._display_name(pa participants, nick text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(nick), ''),
                  btrim(pa.first_name || case when pa.last_name <> '' then ' ' || left(pa.last_name, 1) || '.' else '' end))
$$;

-- A signed-in participant tapped someone's badge and pressed Connect. Counts only once mutual.
-- The pair lock makes the reported status exact when both people tap each other at the same moment.
create or replace function public.record_connection(p_from_participant_id uuid, p_tag_public_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me participants%rowtype; tg tags%rowtype; them uuid; existed boolean; mutual boolean;
begin
  select * into me from participants where id = p_from_participant_id;
  if not found or not _eligible(me) then return jsonb_build_object('code', 'NOT_ELIGIBLE'); end if;
  select * into tg from tags where public_id = p_tag_public_id;
  if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if tg.event_id <> me.event_id then return jsonb_build_object('code', 'WRONG_EVENT'); end if;
  if tg.retired_at is not null then return jsonb_build_object('code', 'TAG_REPLACED'); end if;
  select participant_id into them from tag_assignments where tag_id = tg.id and ended_at is null;
  if them is null then return jsonb_build_object('code', 'TAG_UNASSIGNED'); end if;
  if them = me.id then return jsonb_build_object('code', 'SELF'); end if;
  -- Participants must have come through the door (stops pre-event farming with shared links).
  -- Staff badges (organizers etc.) skip the door, so they are exempt.
  if me.badge_role = 'participant' and not exists (
      select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
       where s.participant_id = me.id and c.kind = 'door' and s.voided_at is null) then
    return jsonb_build_object('code', 'NOT_CHECKED_IN');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(me.id, them)::text || greatest(me.id, them)::text, 0));
  insert into connection_taps (event_id, from_participant_id, to_participant_id, via_tag_id)
  values (me.event_id, me.id, them, tg.id)
  on conflict (from_participant_id, to_participant_id) do nothing;
  existed := not found;
  mutual := exists (select 1 from connection_taps where from_participant_id = them and to_participant_id = me.id);
  return jsonb_build_object('code',
    case when mutual and existed then 'ALREADY_MUTUAL' when mutual then 'MUTUAL'
         when existed then 'ALREADY_PENDING' else 'PENDING' end,
    'otherId', them);
end $$;

-- "My connections": mutual only, newest first. Nickname + LinkedIn + link to their badge page.
create or replace function public.my_connections(p_participant_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'mutual', coalesce(jsonb_agg(jsonb_build_object(
        'participantId', o.id, 'displayName', _display_name(o, pr.nickname), 'badgeRole', o.badge_role,
        'linkedinUrl', case when coalesce(pr.visibility, 'public') = 'public' and pr.hidden_by_staff_at is null
                            then pr.linkedin_url end,
        'badgePublicId', (select t.public_id from tag_assignments a join tags t on t.id = a.tag_id
                           where a.participant_id = o.id and a.ended_at is null),
        'mutualAt', greatest(a.created_at, b.created_at))
      order by greatest(a.created_at, b.created_at) desc) filter (where o.id is not null), '[]'::jsonb),
    'pendingOut', (select count(*) from connection_taps x
                    where x.from_participant_id = p_participant_id
                      and not exists (select 1 from connection_taps y
                                       where y.from_participant_id = x.to_participant_id
                                         and y.to_participant_id = p_participant_id)))
    from connection_taps a
    join connection_taps b on b.from_participant_id = a.to_participant_id and b.to_participant_id = a.from_participant_id
    join participants o on o.id = a.to_participant_id and o.deleted_at is null
    left join profiles pr on pr.participant_id = o.id
   where a.from_participant_id = p_participant_id
$$;

do $$ declare f text; begin
  foreach f in array array['_display_name(participants,text)', 'record_connection(uuid,text)', 'my_connections(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
alter table connection_taps enable row level security;

-- Added in V6 (not in the reference SQL) ------------------------------------------------------------

-- PLAN §13 connection metrics for the dashboard. Attendees only (badge_role 'participant'), no test or
-- deleted rows, like the other attendee metrics.
create or replace function public.connection_stats(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with people as (
    select id from participants where event_id = p_event_id and not is_test and deleted_at is null and badge_role = 'participant'
  ),
  mutual as (
    select a.from_participant_id as me, a.to_participant_id as other
      from connection_taps a
      join connection_taps b on b.from_participant_id = a.to_participant_id and b.to_participant_id = a.from_participant_id
     where a.event_id = p_event_id
       and a.from_participant_id in (select id from people) and a.to_participant_id in (select id from people)
  ),
  checked as (
    select distinct s.participant_id from scans s join checkpoints c on c.id = s.checkpoint_id
     where s.event_id = p_event_id and c.kind = 'door' and s.voided_at is null and s.participant_id in (select id from people)
  )
  select jsonb_build_object(
    'mutualPairs', (select count(*) from mutual where me < other),
    'peopleWithAny', (select count(distinct me) from mutual),
    'checkedIn', (select count(*) from checked))
$$;
revoke all on function public.connection_stats(uuid) from public, anon, authenticated;
grant execute on function public.connection_stats(uuid) to service_role;

-- holder_involvement gains `connections`. Otherwise identical to 20261009231158_v2_involvement.sql.
create or replace function public.holder_involvement(p_participant_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with live as (
    select s.scanned_at, s.serving_no, c.id as checkpoint_id, c.name, c.kind, c.points
      from scans s join checkpoints c on c.id = s.checkpoint_id
     where s.participant_id = p_participant_id and s.voided_at is null
  )
  select jsonb_build_object(
    'doorAt', (select min(scanned_at) from live where kind = 'door'),
    'meals', coalesce((
      select jsonb_agg(jsonb_build_object('checkpointId', m.checkpoint_id, 'name', m.name, 'servings', m.servings) order by m.first_at)
        from (select checkpoint_id, name, min(scanned_at) as first_at,
                     jsonb_agg(jsonb_build_object('no', serving_no, 'at', scanned_at) order by serving_no) as servings
                from live where kind = 'meal' group by checkpoint_id, name) m), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('checkpointId', checkpoint_id, 'name', name, 'kind', kind, 'at', scanned_at, 'points', points) order by scanned_at)
        from live where kind in ('session', 'custom')), '[]'::jsonb),
    'points', (select coalesce(sum(points), 0) from live where kind <> 'meal'),
    -- V6: mutual connections (both directions tapped), for the badge-page staff panel.
    'connections', (select count(*) from connection_taps a
                      join connection_taps b2 on b2.from_participant_id = a.to_participant_id and b2.to_participant_id = a.from_participant_id
                      join participants o on o.id = a.to_participant_id and o.deleted_at is null
                     where a.from_participant_id = p_participant_id))
$$;
