-- V8 (PLAN F26, §12.4). Recap numbers for one attendee, and profile retention per event.

-- What the recap email reports for one person. Live scans only (I-9); points by the leaderboard's
-- rules (points_as_of, everything committed); connections = mutual pairs with people who still count.
create or replace function public.recap_stats(p_participant_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with pa as (select * from participants where id = p_participant_id),
  live as (
    select c.kind from scans s join checkpoints c on c.id = s.checkpoint_id
     where s.participant_id = p_participant_id and s.voided_at is null),
  pts as (select * from points_as_of((select event_id from pa), 'infinity') where participant_id = p_participant_id)
  select jsonb_build_object(
    'workshops',  (select count(*) from live where kind = 'session'),
    'activities', (select count(*) from live where kind = 'custom'),
    'connections', (select count(*) from connection_taps a
                      join connection_taps b on b.from_participant_id = a.to_participant_id and b.to_participant_id = a.from_participant_id
                      join participants o on o.id = a.to_participant_id and o.deleted_at is null and not o.is_test
                     where a.from_participant_id = p_participant_id),
    'activityPoints',   coalesce((select activity from pts), 0),
    'networkingPoints', coalesce((select networking from pts), 0))
$$;

-- PLAN F26.3: after ends_at + profile_retention_days, delete the event's profiles, connection taps,
-- sign-in codes and sessions, and revoke its edit keys ('retention'). Tags, badge links, scans and
-- participants stay (aggregates and the badge page's "This badge was used at …"). One transaction;
-- idempotent (a second run finds nothing and writes no audit row). Audit detail is counts only (I-11).
create or replace function public.retain_event_profiles(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare ev events%rowtype; n_profiles int; n_keys int; n_sessions int; n_codes int; n_taps int; d jsonb;
begin
  select * into ev from events where id = p_event_id;
  if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if now() < ev.ends_at + make_interval(days => ev.profile_retention_days) then
    return jsonb_build_object('code', 'NOT_DUE');
  end if;
  update profile_keys k set revoked_at = now(), revoke_reason = 'retention'
    from participants p where p.id = k.participant_id and p.event_id = p_event_id and k.revoked_at is null;
  get diagnostics n_keys = row_count;
  delete from participant_sessions s using participants p where p.id = s.participant_id and p.event_id = p_event_id;
  get diagnostics n_sessions = row_count;
  delete from signin_codes c using participants p where p.id = c.participant_id and p.event_id = p_event_id;
  get diagnostics n_codes = row_count;
  delete from connection_taps where event_id = p_event_id;
  get diagnostics n_taps = row_count;
  delete from profiles pr using participants p where p.id = pr.participant_id and p.event_id = p_event_id;
  get diagnostics n_profiles = row_count;
  d := jsonb_build_object('profiles', n_profiles, 'keys', n_keys, 'sessions', n_sessions, 'codes', n_codes, 'taps', n_taps);
  if n_profiles + n_keys + n_sessions + n_codes + n_taps > 0 then -- the daily run stays quiet once done
    insert into audit_log (event_id, actor_kind, action, detail) values (p_event_id, 'system', 'privacy.profile_retention', d);
  end if;
  return jsonb_build_object('code', 'RETAINED') || d;
end $$;

do $$ declare f text; begin
  foreach f in array array['recap_stats(uuid)', 'retain_event_profiles(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
