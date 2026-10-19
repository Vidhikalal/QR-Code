-- SPEC v0.6 (F13 step 4, F14, §11): the hacker menu. Attendees keep an emergency contact and their own dietary
-- notes; organizers write the event's schedule and emergency info. The contact is personal data: organizers
-- only, never in audit detail (I-11), deleted with the tombstone and by retention.

alter table participants
  add column emergency_name     text check (length(emergency_name) between 1 and 100),
  add column emergency_phone    text check (emergency_phone ~ '^[0-9+() .-]{3,30}$'),
  add column emergency_relation text check (length(emergency_relation) <= 60),
  -- When the attendee changed their dietary notes themselves; from then on the Sheet no longer overwrites them.
  add column dietary_set_at     timestamptz,
  add constraint participants_emergency_pair check ((emergency_name is null) = (emergency_phone is null));

alter table events
  add column schedule       text not null default '' check (length(schedule) <= 5000),
  add column emergency_info text not null default '' check (length(emergency_info) <= 2000);

-- The attendee's own fields, already validated by the app (parseProfileInput). A null argument leaves the
-- column as it is; '' clears LinkedIn or dietary notes. The contact is written whole, when a name is given.
-- *_set_at only moves on a real change, so confirming the Sheet's value (prefilled on the RSVP) keeps the
-- Sheet in charge. Callers check who may write (save_hacker_profile, rsvp_respond).
create function public._set_hacker_profile(
  p_participant_id uuid, p_linkedin_url text, p_public boolean, p_dietary_notes text,
  p_emergency_name text, p_emergency_phone text, p_emergency_relation text
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
    updated_at = now()
  where id = p_participant_id and num_nonnulls(p_linkedin_url, p_public, p_dietary_notes, p_emergency_name) > 0
$$;
revoke all on function public._set_hacker_profile(uuid, text, boolean, text, text, text, text) from public, anon, authenticated;

-- /me/<slug>/profile and /emergency: only the signed-in attendee's own row (verified email), accepted, not
-- deleted, in an event that ended at most 30 days ago. Audit holds the sharing flag at most (I-11).
create function public.save_hacker_profile(
  p_participant_id uuid, p_email text, p_user_id uuid,
  p_linkedin_url text default null, p_public boolean default null, p_dietary_notes text default null,
  p_emergency_name text default null, p_emergency_phone text default null, p_emergency_relation text default null
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
                              p_emergency_name, p_emergency_phone, p_emergency_relation);
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (ev, p_user_id, 'participant', 'profile.update', p_participant_id, jsonb_strip_nulls(jsonb_build_object('public', p_public)));
  return true;
end $$;
revoke all on function public.save_hacker_profile(uuid, text, uuid, text, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_hacker_profile(uuid, text, uuid, text, boolean, text, text, text, text) to service_role;

-- F13 step 4 (v0.6): Yes carries the emergency contact and networking profile, stored in the same transaction.
-- Same as 20261016220126 otherwise. Dropped first: two overloads would make rsvp_respond($1, true) ambiguous.
drop function public.rsvp_respond(text, boolean);
create function public.rsvp_respond(
  p_token_hash text, p_going boolean,
  p_linkedin_url text default null, p_public boolean default null, p_dietary_notes text default null,
  p_emergency_name text default null, p_emergency_phone text default null, p_emergency_relation text default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.rsvp_token_hash = p_token_hash and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;

  if p_going then
    perform _set_hacker_profile(pa.id, p_linkedin_url, p_public, p_dietary_notes,
                                p_emergency_name, p_emergency_phone, p_emergency_relation);
    if pa.status <> 'accepted' then
      update participants set status = 'accepted', updated_at = now() where id = pa.id;
      insert into audit_log (event_id, actor_kind, action, subject_id) values (pa.event_id, 'participant', 'rsvp.yes', pa.id);
      if not exists (select 1 from passes where participant_id = pa.id and revoked_at is null)
         and coalesce((select revoke_reason from passes where participant_id = pa.id order by issued_at desc limit 1), '') <> 'manual' then
        -- A re-sent RSVP still waiting in the outbox would otherwise block the pass email.
        update email_outbox set status = 'cancelled', locked_until = null
         where participant_id = pa.id and kind = 'rsvp' and status in ('pending','sending');
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
revoke all on function public.rsvp_respond(text, boolean, text, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.rsvp_respond(text, boolean, text, boolean, text, text, text, text) to service_role;

-- F13: the RSVP page, now with the Sheet's dietary notes and LinkedIn to prefill the Yes form. Never the
-- emergency contact. Same as 20261016212552 otherwise.
create or replace function public.rsvp_lookup(p_token_hash text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'participantId', pa.id,
    'email', pa.email,
    'firstName', pa.first_name,
    'status', pa.status,
    'hasAccount', exists (select 1 from auth.users u where lower(u.email) = pa.email),
    'profile', jsonb_build_object('dietaryNotes', pa.dietary_notes, 'linkedinUrl', pa.linkedin_url, 'profilePublic', pa.profile_public),
    'event', jsonb_build_object('name', e.name, 'venue', e.venue, 'startsAt', e.starts_at, 'timezone', e.timezone))
    from participants pa join events e on e.id = pa.event_id
   where pa.rsvp_token_hash = p_token_hash and pa.deleted_at is null and e.ends_at > now()
$$;

-- §6.5 / F14: the holder tapping their own badge also gets {self, slug}, so the page opens their menu.
-- Same as 20261016193219 otherwise.
create or replace function public.badge_profile(p_uid text, p_viewer_id uuid, p_viewer_email text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with link as (
    select b.event_id, e.slug, pa.email, pa.first_name, pa.last_name, pa.linkedin_url, pa.profile_public
      from badges b
      join participants pa on pa.id = b.participant_id
      join events e on e.id = b.event_id
     where b.uid = p_uid and pa.deleted_at is null and pa.status = 'accepted'
       and e.ends_at > now() - interval '30 days'
     order by b.linked_at desc
     limit 1
  )
  select case
           when not (exists (select 1 from participants v
                              where v.event_id = l.event_id and v.email = lower(btrim(p_viewer_email))
                                and v.status = 'accepted' and v.deleted_at is null)
                     or exists (select 1 from event_staff s where s.event_id = l.event_id and s.user_id = p_viewer_id))
             then jsonb_build_object('allowed', false)
           when l.profile_public
             then jsonb_build_object('allowed', true, 'public', true, 'firstName', l.first_name,
                                     'lastName', l.last_name, 'linkedinUrl', l.linkedin_url)
           else jsonb_build_object('allowed', true, 'public', false)
         end
         || case when l.email = lower(btrim(p_viewer_email)) then jsonb_build_object('self', true, 'slug', l.slug)
                 else '{}'::jsonb end
    from link l
$$;

-- §5.1 tombstone, now also deleting the emergency contact. Same as 20261016171225 otherwise.
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

-- F3: same as 20261019190418, except dietary notes the attendee set themselves (dietary_set_at) are kept,
-- like their LinkedIn.
create or replace function public.ingest_sheet_row(
  p_event_id      uuid,
  p_external_id   text,
  p_email         text,
  p_first_name    text,
  p_last_name     text,
  p_search_text   text,
  p_dietary_notes text    default null,
  p_linkedin_url  text    default null,
  p_dry_run       boolean default false
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pa participants%rowtype;
  email_changed boolean;
begin
  select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;

  if not found then
    if exists (select 1 from participants where event_id = p_event_id and email = p_email) then
      return 'CONFLICT_DUPLICATE_EMAIL';
    end if;
    if p_dry_run then return 'CREATED'; end if;
    begin
      insert into participants (event_id, external_id, email, first_name, last_name, search_text,
                                dietary_notes, linkedin_url, status, source)
      values (p_event_id, p_external_id, p_email, p_first_name, p_last_name, p_search_text,
              p_dietary_notes, p_linkedin_url, 'pending', 'sheet')
      on conflict (event_id, external_id) do nothing
      returning * into pa;
    exception when unique_violation then
      -- (event_id, email) taken by a concurrent insert under another external_id.
      return 'CONFLICT_DUPLICATE_EMAIL';
    end;
    if found then return 'CREATED'; end if;
    -- A concurrent request inserted this external_id first: continue as an existing row.
    select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;
  end if;

  if pa.deleted_at is not null then
    return 'UNCHANGED';
  end if;

  email_changed := pa.email <> p_email;
  if not email_changed
     and pa.first_name    is not distinct from p_first_name
     and pa.last_name     is not distinct from p_last_name
     and (pa.dietary_set_at is not null or pa.dietary_notes is not distinct from p_dietary_notes)
     and (pa.linkedin_set_at is not null or pa.linkedin_url is not distinct from p_linkedin_url) then
    return 'UNCHANGED';
  end if;
  if email_changed and exists (select 1 from participants where event_id = p_event_id and email = p_email and id <> pa.id) then
    return 'CONFLICT_DUPLICATE_EMAIL';
  end if;
  if not p_dry_run then
    update participants
       set email = p_email, first_name = p_first_name, last_name = p_last_name, search_text = p_search_text,
           updated_at = now(),
           dietary_notes = case when pa.dietary_set_at is null then p_dietary_notes else pa.dietary_notes end,
           linkedin_url = case when pa.linkedin_set_at is null then p_linkedin_url else pa.linkedin_url end,
           -- The RSVP link went to the old address: it must not answer (or make an account) for the new one.
           rsvp_token_hash = case when email_changed then null else rsvp_token_hash end
     where id = pa.id;
    if email_changed and pa.status = 'accepted' then
      -- Rotation on send revokes the old pass. A pending row already queued will go to the new address.
      insert into email_outbox (participant_id, kind) values (pa.id, 'pass_reissued')
      on conflict (participant_id) where status in ('pending','sending') do nothing;
      insert into audit_log (event_id, actor_kind, action, subject_id)
      values (p_event_id, 'sheet_sync', 'participant.email_change', pa.id);
    end if;
  end if;
  return case when email_changed and pa.status = 'accepted' then 'PASS_QUEUED' else 'UPDATED' end;
end $$;
