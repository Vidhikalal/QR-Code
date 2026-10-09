-- V5b. holder_involvement() (PLAN §8.2; the PLAN names it without SQL) and event_metrics with meal
-- first servings vs seconds (PLAN §13). Both read-only.

-- Everything the badge page's staff panel shows about what a person has done. Live scans only (I-9);
-- points are derived from checkpoint points, never stored (I-22). Meals are worth 0 by constraint.
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
    'points', (select coalesce(sum(points), 0) from live where kind <> 'meal'))
$$;
revoke all on function public.holder_involvement(uuid) from public, anon, authenticated;
grant execute on function public.holder_involvement(uuid) to service_role;

-- Meals add firstServings / seconds. Otherwise identical to 20261008192908_v2_profiles_fixes.sql.
create or replace function public.event_metrics(p_event_id uuid, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with ev as (select * from events where id = p_event_id),
  eligible as (
    select * from participants where event_id = p_event_id and not is_test and deleted_at is null
  ),
  -- V3: attendees are badge_role 'participant'; organizers' own badge rows (ensure_staff_attendee)
  -- would otherwise count as accepted no-shows.
  attendees as (select * from eligible where badge_role = 'participant'),
  live as (
    select s.* from scans s join eligible p on p.id = s.participant_id
     where s.event_id = p_event_id and s.voided_at is null
  ),
  door_live as (
    select l.* from live l join checkpoints d on d.id = l.checkpoint_id and d.kind = 'door'
     where l.participant_id in (select id from attendees)
  ),
  checked as (select distinct participant_id from door_live)
  select jsonb_build_object(
    'accepted',  (select count(*) from attendees where status = 'accepted'),
    'checkedIn', (select count(*) from checked),
    'noShows',   (select count(*) from attendees e
                   where e.status = 'accepted' and not exists (select 1 from checked c where c.participant_id = e.id)),
    'checkpoints', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'kind', c.kind, 'isOpen', c.is_open, 'capacity', c.capacity,
               'requiresCheckin', c.requires_checkin, 'sortOrder', c.sort_order, 'liveScans', v.live_scans)
             -- V5b: meals split into first servings and seconds (PLAN §13), same exclusions as live_scans.
             || case when c.kind = 'meal' then jsonb_build_object(
                  'firstServings', (select count(*) from live l where l.checkpoint_id = c.id and l.serving_no = 1),
                  'seconds',       (select count(*) from live l where l.checkpoint_id = c.id and l.serving_no > 1))
                else '{}'::jsonb end
             order by c.sort_order, c.name)
        from checkpoints c join v_checkpoint_counts v on v.checkpoint_id = c.id
       where c.event_id = p_event_id), '[]'::jsonb),
    -- UTC buckets anchored on starts_at; labelled in the event timezone by the app (DST-safe).
    'arrivals', coalesce((
      select jsonb_agg(jsonb_build_object('bucketUtc', b.bucket, 'arrivals', b.n) order by b.bucket)
        from (select date_bin('15 minutes', d.scanned_at, (select starts_at from ev)) as bucket, count(*) as n
                from door_live d group by 1) b), '[]'::jsonb),
    'outbox', (
      select jsonb_build_object(
               'pending', count(*) filter (where o.status in ('pending', 'sending')),
               'failed',  count(*) filter (where o.status = 'failed'))
        from email_outbox o join participants p on p.id = o.participant_id
       where p.event_id = p_event_id),
    -- §15 / T-ADM-07: staff with ≥ 30 NOT_FOUND in the last 5 minutes (the 429 threshold).
    'notFound', coalesce((
      select jsonb_agg(jsonb_build_object('staffUserId', a.staff_user_id, 'displayName', sp.display_name, 'count', a.n)
             order by a.n desc)
        from (select staff_user_id, count(*) as n from scan_attempts
               where event_id = p_event_id and result_code = 'NOT_FOUND' and created_at > p_now - interval '5 minutes'
               group by 1 having count(*) >= 30) a
        left join staff_profiles sp on sp.user_id = a.staff_user_id), '[]'::jsonb),
    'scanProblems', coalesce((
      select jsonb_agg(jsonb_build_object('checkpointId', checkpoint_id, 'code', result_code, 'count', n) order by n desc)
        from (select checkpoint_id, result_code, count(*) as n from scan_attempts
               where event_id = p_event_id and result_code <> 'ACCEPTED' group by 1, 2) x), '[]'::jsonb)
  )
$$;
revoke all on function public.event_metrics(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.event_metrics(uuid, timestamptz) to service_role;
