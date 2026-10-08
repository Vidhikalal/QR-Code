-- V3 fixes on top of v2_profiles (reference 03) and the S6 admin migration.

-- 1. I-12: search_text comes from the app's toSearchText(display_name). SQL lower() keeps accents, so
--    "Zoë" would not be found by "zoe". Same body as 03 otherwise. No caller existed before V3.
drop function public.ensure_staff_attendee(uuid, uuid);
create or replace function public.ensure_staff_attendee(p_event_id uuid, p_user_id uuid, p_search_text text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r staff_role; em text; dn text; pid uuid;
begin
  select role into r from event_staff where event_id = p_event_id and user_id = p_user_id;
  if not found then return jsonb_build_object('code', 'FORBIDDEN'); end if;
  select lower(btrim(email)) into em from auth.users where id = p_user_id;
  select display_name into dn from staff_profiles where user_id = p_user_id;
  if em is null or dn is null then return jsonb_build_object('code', 'PROFILE_INCOMPLETE'); end if;
  select id into pid from participants where event_id = p_event_id and staff_user_id = p_user_id;
  if pid is null then
    insert into participants (event_id, email, first_name, last_name, search_text, status, source,
                              badge_role, staff_user_id)
    values (p_event_id, em, dn, '', p_search_text, 'accepted', 'staff',
            case when r = 'organizer' then 'organizer' else 'volunteer' end, p_user_id)
    on conflict (event_id, email) do update
       set staff_user_id = excluded.staff_user_id, badge_role = excluded.badge_role,
           status = 'accepted', updated_at = now()
    returning id into pid;
  end if;
  insert into profiles (participant_id, nickname) values (pid, left(dn, 40)) on conflict (participant_id) do nothing;
  return jsonb_build_object('code', 'OK', 'participantId', pid);
end $$;
revoke all on function public.ensure_staff_attendee(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_staff_attendee(uuid, uuid, text) to service_role;

-- 2. Attendee metrics (accepted, checked in, no-shows, arrivals) count badge_role 'participant' only.
--    Checkpoint scan counts are unchanged. Otherwise identical to 20260924072215_admin.sql.
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
