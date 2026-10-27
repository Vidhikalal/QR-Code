-- SPEC F13 (v0.9): an RSVP deadline per event. No reply by then counts as a no, and invitees who
-- haven't answered get a reminder at 10:00 local on each of the three days ending on the deadline day.
-- run_rsvp_jobs() does both; a scheduler calls it through POST /api/cron.

alter table events add column rsvp_deadline timestamptz;

-- One row per reminder day that has gone out, so each fires once however often the scheduler runs.
create table reminder_runs (
  event_id uuid not null references events on delete cascade,
  kind text not null check (kind in ('rsvp', 'profile')),
  run_on date not null,
  primary key (event_id, kind, run_on)
);
alter table reminder_runs enable row level security;

alter table email_outbox drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check
  check (kind in ('pass_issued', 'pass_reissued', 'rsvp', 'team_invite', 'rsvp_reminder', 'profile_reminder'));

-- When an invitation stops taking a Yes: the event's deadline, or 48 h after it was sent if that's later
-- (late invites, e.g. from the waitlist). No deadline: never. greatest() skips nulls, hence the case.
create function public._rsvp_closes(p_deadline timestamptz, p_sent_at timestamptz)
returns timestamptz language sql immutable set search_path = public, pg_temp as $$
  select case when p_deadline is null then null else greatest(p_deadline, p_sent_at + interval '48 hours') end
$$;
revoke all on function public._rsvp_closes(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public._rsvp_closes(timestamptz, timestamptz) to service_role;

-- F13: the RSVP page, now with when the invitation closes. Same as 20261019214235 otherwise.
create or replace function public.rsvp_lookup(p_token_hash text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'participantId', pa.id,
    'email', pa.email,
    'firstName', pa.first_name,
    'status', pa.status,
    'hasAccount', exists (select 1 from auth.users u where lower(u.email) = pa.email),
    'profile', jsonb_build_object('dietaryNotes', pa.dietary_notes, 'linkedinUrl', pa.linkedin_url, 'profilePublic', pa.profile_public),
    'event', jsonb_build_object('name', e.name, 'venue', e.venue, 'startsAt', e.starts_at, 'timezone', e.timezone),
    'closesAt', _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at),
    -- The accepted can still say No (give their spot away) until the event ends.
    'closed', pa.status <> 'accepted' and coalesce(_rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) < now(), false))
    from participants pa join events e on e.id = pa.event_id
   where pa.rsvp_token_hash = p_token_hash and pa.deleted_at is null and e.ends_at > now()
$$;

-- F13: same answer as 20261020003324, plus the deadline (a Yes after it is CLOSED) and a Yes that also
-- cancels a waiting reminder, so the pass email is never blocked by the one-email-in-flight index.
create or replace function public.rsvp_respond(
  p_token_hash text, p_going boolean,
  p_linkedin_url text default null, p_public boolean default null, p_dietary_notes text default null,
  p_emergency_name text default null, p_emergency_phone text default null, p_emergency_relation text default null,
  p_looking_for_team boolean default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; closes timestamptz;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.rsvp_token_hash = p_token_hash and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
  select _rsvp_closes(rsvp_deadline, pa.rsvp_sent_at) into closes from events where id = pa.event_id;

  if p_going then
    if pa.status <> 'accepted' and closes < now() then return 'CLOSED'; end if;
    update participants set looking_for_team = p_looking_for_team where id = pa.id and p_looking_for_team is not null;
    perform _set_hacker_profile(pa.id, p_linkedin_url, p_public, p_dietary_notes,
                                p_emergency_name, p_emergency_phone, p_emergency_relation);
    if pa.status <> 'accepted' then
      update participants set status = 'accepted', updated_at = now() where id = pa.id;
      insert into audit_log (event_id, actor_kind, action, subject_id) values (pa.event_id, 'participant', 'rsvp.yes', pa.id);
      if not exists (select 1 from passes where participant_id = pa.id and revoked_at is null)
         and coalesce((select revoke_reason from passes where participant_id = pa.id order by issued_at desc limit 1), '') <> 'manual' then
        -- A re-sent RSVP or a reminder still waiting in the outbox would otherwise block the pass email.
        update email_outbox set status = 'cancelled', locked_until = null
         where participant_id = pa.id and kind in ('rsvp', 'rsvp_reminder', 'profile_reminder') and status in ('pending','sending');
        insert into email_outbox (participant_id, kind) values (pa.id, 'pass_issued')
        on conflict (participant_id) where status in ('pending','sending') do nothing;
      end if;
    end if;
    return 'GOING';
  end if;

  if pa.status <> 'withdrawn' then
    update participants set status = 'withdrawn', updated_at = now() where id = pa.id;
    update passes set revoked_at = now(), revoke_reason = 'status_change'
     where participant_id = pa.id and revoked_at is null;
    update email_outbox set status = 'cancelled', locked_until = null
     where participant_id = pa.id and status in ('pending','sending');
    delete from badges where participant_id = pa.id;  -- §6.5: revoking a pass removes the badge link
    insert into audit_log (event_id, actor_kind, action, subject_id) values (pa.event_id, 'participant', 'rsvp.no', pa.id);
  end if;
  return 'NOT_GOING';
end $$;

-- F4/F13: the drainer stores a new RSVP token only while it still holds the job (as in
-- 20261016215756), now for reminders too. It locks the participant before the job, the order every
-- answer and queue function uses. Only a real invitation (kind 'rsvp') restarts the 48 h; a reminder
-- goes out only while they can still answer. Returns when the invitation closes, for the email.
drop function public.set_rsvp_token(uuid, text);
create function public.set_rsvp_token(p_outbox_id uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare job email_outbox%rowtype; pa participants%rowtype; e events%rowtype;
begin
  select * into job from email_outbox where id = p_outbox_id;
  if not found then return null; end if;
  select * into pa from participants where id = job.participant_id for update;
  perform 1 from email_outbox where id = p_outbox_id and kind in ('rsvp', 'rsvp_reminder') and status = 'sending' for update;
  if not found then return null; end if;
  select * into e from events where id = pa.event_id;
  -- (Nor hours late, e.g. after an email outage: the next day's reminder will do.)
  if job.kind = 'rsvp_reminder' and (pa.status <> 'pending' or pa.deleted_at is not null or e.ends_at <= now()
      or coalesce(_rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) <= now(), false) or job.created_at < now() - interval '6 hours') then
    return null;
  end if;
  update participants
     set rsvp_token_hash = p_token_hash,
         rsvp_sent_at = case when job.kind = 'rsvp' then now() else rsvp_sent_at end
   where id = pa.id
  returning * into pa;
  return jsonb_build_object('closesAt', _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at));
end $$;
revoke all on function public.set_rsvp_token(uuid, text) from public, anon, authenticated;
grant execute on function public.set_rsvp_token(uuid, text) to service_role;

-- §11 Resend: as in 20260924072215, but a reminder waiting in the outbox never blocks the pass.
create or replace function public.enqueue_pass(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; queued uuid;
begin
  select * into pa from participants where id = p_participant_id and event_id = p_event_id and deleted_at is null for update;
  if not found then return 'NOT_FOUND'; end if;
  if pa.status <> 'accepted' then return 'NOT_ACCEPTED'; end if;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = pa.id and kind in ('rsvp_reminder', 'profile_reminder') and status in ('pending', 'sending');
  insert into email_outbox (participant_id, kind) values (pa.id, 'pass_reissued')
  on conflict (participant_id) where status in ('pending', 'sending') do nothing
  returning id into queued;
  if queued is null then return 'IN_FLIGHT'; end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'pass.resend', pa.id);
  return 'QUEUED';
end $$;

-- F13: as in 20261016220126, but an organizer's RSVP replaces a reminder still waiting in the outbox
-- (one email in flight per person), so the re-send goes out and restarts their 48 h.
create or replace function public.queue_rsvps(p_event_id uuid, p_participant_ids uuid[], p_actor uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform 1 from participants where event_id = p_event_id and id = any(p_participant_ids) order by id for update;
  update email_outbox o set status = 'cancelled', locked_until = null
    from participants pa
   where pa.id = o.participant_id and pa.event_id = p_event_id and pa.id = any(p_participant_ids)
     and o.kind = 'rsvp_reminder' and o.status = 'pending';
  insert into email_outbox (participant_id, kind)
  select id, 'rsvp' from participants
   where event_id = p_event_id and id = any(p_participant_ids) and deleted_at is null and status <> 'accepted'
  on conflict (participant_id) where status in ('pending','sending') do nothing;
  get diagnostics n = row_count;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, detail)
  values (p_event_id, p_actor, 'staff', 'rsvp.send', jsonb_build_object('count', n));
  return n;
end $$;

-- F13 (v0.9), every few minutes from POST /api/cron.
create function public.run_rsvp_jobs(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_expired uuid[]; v_events uuid[]; v_reminded int;
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

  -- Lock everyone either step may change, once and in id order (like queue_rsvps()), so this can't
  -- deadlock with an answer, an RSVP send or another run.
  perform 1 from participants pa join events e on e.id = pa.event_id
   where pa.status = 'pending' and pa.deleted_at is null and pa.rsvp_sent_at is not null
     and (pa.event_id = any(v_events) or (e.ends_at > p_now and _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) < p_now))
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

  -- 2. The reminders, to those who can still answer.
  -- shortcut: someone with another email in flight gets no reminder that day; split outbox_one_inflight by kind if that matters.
  insert into email_outbox (participant_id, kind)
  select pa.id, 'rsvp_reminder' from participants pa join events e on e.id = pa.event_id
   where pa.event_id = any(v_events) and pa.status = 'pending' and pa.deleted_at is null
     and pa.rsvp_sent_at < p_now - interval '24 hours'  -- invited within the last day: the invitation is reminder enough
     and _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) > p_now
  on conflict (participant_id) where status in ('pending','sending') do nothing;
  get diagnostics v_reminded = row_count;

  return jsonb_build_object('expired', cardinality(v_expired), 'reminded', v_reminded);
end $$;
revoke all on function public.run_rsvp_jobs(timestamptz) from public, anon, authenticated;
grant execute on function public.run_rsvp_jobs(timestamptz) to service_role;
