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

-- Points as of a moment (PLAN §7.9): the projector passes the start of the current refresh window,
-- or the freeze time, so the board only moves once an hour ("suspense") and stops at the freeze.
--   activity   = sum of checkpoint points over live scans (meals are 0 by constraint)
--   networking = 1 per mutual connection + the event's organizer bonus when the other person is an organizer
create or replace function public.points_as_of(p_event_id uuid, p_as_of timestamptz)
returns table (participant_id uuid, activity int, networking int, activity_at timestamptz, networking_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with ev as (select * from events where id = p_event_id),
  act as (
    select s.participant_id, sum(c.points)::int as pts, max(s.scanned_at) as at
      from scans s join checkpoints c on c.id = s.checkpoint_id
     where s.event_id = p_event_id and s.voided_at is null and c.points > 0 and s.scanned_at <= p_as_of
     group by 1),
  net as (
    select a.from_participant_id as participant_id,
           sum(1 + case when o.badge_role = 'organizer' and me.badge_role <> 'organizer'
                        then (select organizer_connection_bonus from ev) else 0 end)::int as pts,
           max(greatest(a.created_at, b.created_at)) as at
      from connection_taps a
      join connection_taps b on b.from_participant_id = a.to_participant_id and b.to_participant_id = a.from_participant_id
      join participants o  on o.id  = a.to_participant_id   and o.deleted_at is null and not o.is_test
      join participants me on me.id = a.from_participant_id
     where a.event_id = p_event_id and greatest(a.created_at, b.created_at) <= p_as_of
     group by 1)
  select pa.id, coalesce(act.pts, 0), coalesce(net.pts, 0), act.at, net.at
    from participants pa
    left join act on act.participant_id = pa.id
    left join net on net.participant_id = pa.id
   where pa.event_id = p_event_id
$$;

create or replace function public.leaderboard(p_event_id uuid, p_kind text, p_as_of timestamptz, p_limit int default 10)
returns table (rank int, participant_id uuid, display_name text, points int, reached_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with ev as (select * from events where id = p_event_id),
  scored as (
    select pa.id, _display_name(pa, pr.nickname) as name,
           case when p_kind = 'networking' then pt.networking else pt.activity end as pts,
           case when p_kind = 'networking' then pt.networking_at else pt.activity_at end as at
      from points_as_of(p_event_id, p_as_of) pt
      join participants pa on pa.id = pt.participant_id
      left join profiles pr on pr.participant_id = pa.id
     where _eligible(pa) and not pa.is_test
       and (pa.badge_role = 'participant' or (pa.badge_role = 'organizer' and (select organizers_compete from ev))))
  select (rank() over (order by pts desc))::int, id, name, pts, at
    from scored where pts > 0
   order by pts desc, at asc, name, id
   limit p_limit
$$;

do $$ declare f text; begin
  foreach f in array array[
    '_display_name(participants,text)', 'record_connection(uuid,text)', 'my_connections(uuid)',
    'points_as_of(uuid,timestamptz)', 'leaderboard(uuid,text,timestamptz,int)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
alter table connection_taps enable row level security;
