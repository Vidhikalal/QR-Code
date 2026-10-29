-- SPEC F14 (v0.9): profile setup after the RSVP Yes. Staying overnight, allergies with their severity
-- (shown on meal scans), team status and accessibility needs. A profile is finished once the emergency
-- contact, overnight and team status are set (computed, not stored). Allergies and accessibility are
-- personal data: organizers only (plus allergies on meal scans), never logged, deleted by the tombstone
-- and by retention.

alter table participants
  add column overnight text check (overnight in ('yes', 'no', 'unsure')),
  add column allergies text check (length(allergies) between 1 and 300),
  add column allergy_severity text check (allergy_severity in ('mild', 'moderate', 'severe')),
  add column team_status text check (team_status in ('team', 'looking', 'solo')),
  add column accessibility text check (length(accessibility) between 1 and 500),
  add constraint participants_allergy_pair check ((allergies is null) = (allergy_severity is null));

-- As in 20261019214235, plus the setup answers (appended, so existing positional calls still resolve).
-- Allergies and their severity are written together; '' clears both. Team status moves the directory
-- opt-in only when it actually changes, so a later save never undoes an opt-out made on the Team page.
drop function public._set_hacker_profile(uuid, text, boolean, text, text, text, text);
create function public._set_hacker_profile(
  p_participant_id uuid, p_linkedin_url text, p_public boolean, p_dietary_notes text,
  p_emergency_name text, p_emergency_phone text, p_emergency_relation text,
  p_overnight text default null, p_allergies text default null, p_allergy_severity text default null,
  p_team_status text default null, p_accessibility text default null
) returns void language sql set search_path = public, pg_temp as $$
  update participants set
    linkedin_url = case when p_linkedin_url is null then linkedin_url else nullif(p_linkedin_url, '') end,
    linkedin_set_at = case when p_linkedin_url is not null and nullif(p_linkedin_url, '') is distinct from linkedin_url
                           then now() else linkedin_set_at end,
    profile_public = coalesce(p_public, profile_public),
    dietary_notes = case when p_dietary_notes is null then dietary_notes else nullif(p_dietary_notes, '') end,
    dietary_set_at = case when p_dietary_notes is not null and nullif(p_dietary_notes, '') is distinct from dietary_notes
                          then now() else dietary_set_at end,
    emergency_name = coalesce(p_emergency_name, emergency_name),
    emergency_phone = case when p_emergency_name is null then emergency_phone else p_emergency_phone end,
    emergency_relation = case when p_emergency_name is null then emergency_relation else nullif(p_emergency_relation, '') end,
    overnight = coalesce(p_overnight, overnight),
    allergies = case when p_allergies is null then allergies else nullif(p_allergies, '') end,
    allergy_severity = case when p_allergies is null then allergy_severity
                            when nullif(p_allergies, '') is null then null else p_allergy_severity end,
    team_status = coalesce(p_team_status, team_status),
    looking_for_team = case when p_team_status is not null and p_team_status is distinct from team_status and team_id is null
                            then p_team_status = 'looking' else looking_for_team end,
    accessibility = case when p_accessibility is null then accessibility else nullif(p_accessibility, '') end,
    updated_at = now()
  where id = p_participant_id
    and num_nonnulls(p_linkedin_url, p_public, p_dietary_notes, p_emergency_name, p_overnight, p_allergies, p_team_status, p_accessibility) > 0
$$;
revoke all on function public._set_hacker_profile(uuid, text, boolean, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;

-- As in 20261019214235, with the setup answers. Audit still holds the sharing flag at most (I-11).
drop function public.save_hacker_profile(uuid, text, uuid, text, boolean, text, text, text, text);
create function public.save_hacker_profile(
  p_participant_id uuid, p_email text, p_user_id uuid,
  p_linkedin_url text default null, p_public boolean default null, p_dietary_notes text default null,
  p_emergency_name text default null, p_emergency_phone text default null, p_emergency_relation text default null,
  p_overnight text default null, p_allergies text default null, p_allergy_severity text default null,
  p_team_status text default null, p_accessibility text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare ev uuid;
begin
  select pa.event_id into ev
    from participants pa join events e on e.id = pa.event_id
   where pa.id = p_participant_id and pa.email = lower(btrim(p_email)) and pa.status = 'accepted'
     and pa.deleted_at is null and e.ends_at > now() - interval '30 days'
     for update of pa;
  if not found then return false; end if;
  perform _set_hacker_profile(p_participant_id, p_linkedin_url, p_public, p_dietary_notes,
                              p_emergency_name, p_emergency_phone, p_emergency_relation,
                              p_overnight, p_allergies, p_allergy_severity, p_team_status, p_accessibility);
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (ev, p_user_id, 'participant', 'profile.update', p_participant_id, jsonb_strip_nulls(jsonb_build_object('public', p_public)));
  return true;
end $$;
revoke all on function public.save_hacker_profile(uuid, text, uuid, text, boolean, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_hacker_profile(uuid, text, uuid, text, boolean, text, text, text, text, text, text, text, text, text) to service_role;

-- §8 / F7: meal checkpoints also get the allergies and their severity (the API passes them on ACCEPTED
-- only, since record_scan answers REVOKED before it checks the event).
create or replace function public._who(pa participants, k checkpoint_kind)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', pa.id,
    'displayName', btrim(pa.first_name || ' ' || pa.last_name),
    'photoPath', pa.photo_path,
    'status', pa.status,
    'dietaryNotes', case when k = 'meal' then pa.dietary_notes end,
    'allergies', case when k = 'meal' then pa.allergies end,
    'allergySeverity', case when k = 'meal' then pa.allergy_severity end)
$$;

-- §5.1 tombstone: as in 20261020003324, also clearing the setup answers.
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
         overnight = null, allergies = null, allergy_severity = null, team_status = null, accessibility = null,
         team_id = null, looking_for_team = false,
         updated_at = now()
   where id = pa.id;
  update passes set revoked_at = now(), revoke_reason = 'deleted' where participant_id = pa.id and revoked_at is null;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = pa.id and status in ('pending', 'sending');
  delete from badges where participant_id = pa.id;
  delete from team_invites where participant_id = pa.id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'participant.delete', pa.id);
  return jsonb_build_object('code', 'DELETED', 'photoPath', pa.photo_path);
end $$;

-- §11 participants table and CSV (20261016212552), plus the setup answers organizers plan with.
-- Accessibility stays on the participant detail only; the emergency contact is in no CSV.
drop function public.admin_participants(uuid, participant_status, text, boolean);
create function public.admin_participants(
  p_event_id uuid, p_status participant_status default null, p_query text default null, p_no_show boolean default false
) returns table (
  id uuid, first_name text, last_name text, email text, status participant_status, source text, is_test boolean,
  external_id text, dietary_notes text, photo_path text, photo_updated_at timestamptz, pass_state text,
  live_scans int, checked_in boolean, created_at timestamptz, rsvp_sent_at timestamptz,
  overnight text, team_status text, allergies text, allergy_severity text
) language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.first_name, p.last_name, p.email, p.status, p.source, p.is_test, p.external_id, p.dietary_notes,
         p.photo_path, p.photo_updated_at,
         case when exists (select 1 from passes ps where ps.participant_id = p.id and ps.revoked_at is null) then 'active'
              when exists (select 1 from passes ps where ps.participant_id = p.id) then 'revoked'
              else 'none' end as pass_state,
         (select count(*)::int from scans s where s.participant_id = p.id and s.voided_at is null) as live_scans,
         exists (select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
                  where s.participant_id = p.id and c.kind = 'door' and s.voided_at is null) as checked_in,
         p.created_at,
         p.rsvp_sent_at,
         p.overnight, p.team_status, p.allergies, p.allergy_severity
    from participants p
   where p.event_id = p_event_id
     and p.deleted_at is null
     and (p_status is null or p.status = p_status)
     and (p_query is null or p.search_text like '%' || p_query || '%' or p.email like '%' || p_query || '%')
     and (not p_no_show or (p.status = 'accepted' and not p.is_test and not exists (
            select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
             where s.participant_id = p.id and c.kind = 'door' and s.voided_at is null)))
   order by p.last_name, p.first_name, p.id
   limit 1000
$$;
revoke all on function public.admin_participants(uuid, participant_status, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_participants(uuid, participant_status, text, boolean) to service_role;

-- One email in flight per person (outbox_one_inflight): a pass always replaces a waiting reminder, whoever
-- queues it (Resend, an RSVP Yes, a Sheet email change), so a reminder never swallows a pass.
create function public._pass_before_reminders() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = new.participant_id and kind in ('rsvp_reminder', 'profile_reminder') and status in ('pending', 'sending');
  return new;
end $$;
revoke all on function public._pass_before_reminders() from public, anon, authenticated;
create trigger email_outbox_pass_first before insert on email_outbox
  for each row when (new.kind in ('pass_issued', 'pass_reissued')) execute function public._pass_before_reminders();

-- F13/F14: run_rsvp_jobs() as in 20261026170439, plus step 3: at 10:00 local two days before the event,
-- one reminder to accepted hackers who haven't finished their profile. They are locked with everyone else
-- (the outbox row's foreign key would otherwise wait on a participant lock out of order).
create or replace function public.run_rsvp_jobs(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_expired uuid[]; v_events uuid[]; v_profile_events uuid[]; v_reminded int; v_profile_reminded int;
begin
  -- Reminder days due now: 10:00 local on the deadline day and the two days before it, each once, and only
  -- if less than 6 h late (a scheduler that was down doesn't send yesterday's reminder at midnight).
  with due as (
    select e.id as event_id, d.run_on
      from events e
      cross join lateral (select (e.rsvp_deadline at time zone e.timezone)::date - g as run_on from generate_series(0, 2) g) d
     where e.rsvp_deadline is not null and e.ends_at > p_now
       and p_now >= (d.run_on + time '10:00') at time zone e.timezone
       and p_now < ((d.run_on + time '10:00') at time zone e.timezone) + interval '6 hours'
  ), fired as (
    insert into reminder_runs (event_id, kind, run_on) select event_id, 'rsvp', run_on from due
    on conflict do nothing returning event_id
  )
  select coalesce(array_agg(event_id), '{}') into v_events from fired;
  -- The profile reminder: 10:00 local two days before the event starts, once.
  with due as (
    select e.id as event_id, (e.starts_at at time zone e.timezone)::date - 2 as run_on, e.timezone
      from events e
     where e.ends_at > p_now
  ), fired as (
    insert into reminder_runs (event_id, kind, run_on)
    select event_id, 'profile', run_on from due
     where p_now >= (run_on + time '10:00') at time zone timezone
       and p_now < ((run_on + time '10:00') at time zone timezone) + interval '6 hours'
    on conflict do nothing returning event_id
  )
  select coalesce(array_agg(event_id), '{}') into v_profile_events from fired;

  -- Lock everyone any step may change, once and in id order (like queue_rsvps()), so this can't
  -- deadlock with an answer, an RSVP send or another run.
  perform 1 from participants pa join events e on e.id = pa.event_id
   where pa.deleted_at is null
     and ((pa.status = 'pending' and pa.rsvp_sent_at is not null
           and (pa.event_id = any(v_events) or (e.ends_at > p_now and _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) < p_now)))
          or (pa.status = 'accepted' and pa.event_id = any(v_profile_events)))
   -- no key update: never blocks a foreign-key check (e.g. a team invite to them), so no lock cycle with one.
   order by pa.id for no key update of pa;

  -- 1. No reply by their deadline counts as a no: the same as answering No. Their link stays, to say so.
  with gone as (
    update participants pa set status = 'withdrawn', updated_at = now()
      from events e
     where e.id = pa.event_id and pa.status = 'pending' and pa.deleted_at is null and pa.rsvp_sent_at is not null
       and e.ends_at > p_now and _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) < p_now
       -- An organizer's re-send still waiting to go out restarts their 48 h once it is sent.
       and not exists (select 1 from email_outbox o where o.participant_id = pa.id and o.kind = 'rsvp' and o.status in ('pending','sending'))
    returning pa.id, pa.event_id
  ), logged as (
    insert into audit_log (event_id, actor_kind, action, subject_id) select event_id, 'system', 'rsvp.expire', id from gone
  )
  select coalesce(array_agg(id), '{}') into v_expired from gone;
  update passes set revoked_at = now(), revoke_reason = 'status_change' where participant_id = any(v_expired) and revoked_at is null;
  update email_outbox set status = 'cancelled', locked_until = null where participant_id = any(v_expired) and status in ('pending','sending');
  delete from badges where participant_id = any(v_expired);

  -- 2. The RSVP reminders, to those who can still answer.
  -- shortcut: someone with another email in flight gets no reminder that day; split outbox_one_inflight by kind if that matters.
  insert into email_outbox (participant_id, kind)
  select pa.id, 'rsvp_reminder' from participants pa join events e on e.id = pa.event_id
   where pa.event_id = any(v_events) and pa.status = 'pending' and pa.deleted_at is null
     and pa.rsvp_sent_at < p_now - interval '24 hours'  -- invited within the last day: the invitation is reminder enough
     and _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) > p_now
  on conflict (participant_id) where status in ('pending','sending') do nothing;
  get diagnostics v_reminded = row_count;

  -- 3. The profile reminder (F14): finished means the emergency contact, overnight and team status are set.
  insert into email_outbox (participant_id, kind)
  select pa.id, 'profile_reminder' from participants pa
   where pa.event_id = any(v_profile_events) and pa.status = 'accepted' and pa.deleted_at is null
     and (pa.emergency_name is null or pa.overnight is null or pa.team_status is null)
  on conflict (participant_id) where status in ('pending','sending') do nothing;
  get diagnostics v_profile_reminded = row_count;

  return jsonb_build_object('expired', cardinality(v_expired), 'reminded', v_reminded, 'profileReminded', v_profile_reminded);
end $$;
