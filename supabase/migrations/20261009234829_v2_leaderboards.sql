-- V7. Reference 07, the rest (points_as_of, leaderboard), unchanged. The connections part is in
-- 20261009232843_v2_connections.sql.
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
  foreach f in array array['points_as_of(uuid,timestamptz)', 'leaderboard(uuid,text,timestamptz,int)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
