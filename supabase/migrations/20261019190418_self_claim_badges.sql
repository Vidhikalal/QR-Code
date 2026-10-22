-- SPEC v0.5 (§6.5, F3): attendees claim their own badge and set their own LinkedIn.

-- When the attendee last set their LinkedIn on /me; from then on the Sheet no longer overwrites it.
alter table participants add column linkedin_set_at timestamptz;

-- /profile/<uid> "This is my badge": the signed-in attendee (matched by verified email) links an unlinked
-- badge to themselves. Same lock as link_badge(), so it can't deadlock with an organizer's link on Tools.
create or replace function public.claim_badge(p_uid text, p_event_id uuid, p_email text, p_user_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('passline:badge_link'), hashtext(p_event_id::text));
  select pa.id into pid
    from participants pa join events e on e.id = pa.event_id
   where pa.event_id = p_event_id and pa.email = lower(btrim(p_email)) and pa.status = 'accepted'
     and pa.deleted_at is null and e.ends_at > now() - interval '30 days'
     for update of pa;
  if not found then return 'NOT_FOUND'; end if;
  -- One badge per person: claiming a new badge frees the old one. Someone else's badge stays theirs.
  delete from badges where event_id = p_event_id and participant_id = pid;
  insert into badges (uid, event_id, participant_id) values (p_uid, p_event_id, pid);
  -- ids only (I-11): no UID in the detail.
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_user_id, 'participant', 'badge.claim', pid);
  return 'LINKED';
exception when unique_violation then
  return 'BADGE_TAKEN';
end $$;
revoke all on function public.claim_badge(text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_badge(text, uuid, text, uuid) to service_role;

-- /me: the attendee's own LinkedIn (already normalized by the app; '' clears it) and sharing switch.
-- Only their own row (verified email), accepted, in an event that ended at most 30 days ago.
create or replace function public.save_badge_profile(p_participant_id uuid, p_email text, p_linkedin_url text,
                                                     p_public boolean, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare ev uuid;
begin
  update participants pa
     set linkedin_url = nullif(p_linkedin_url, ''), profile_public = p_public, linkedin_set_at = now(), updated_at = now()
    from events e
   where pa.id = p_participant_id and e.id = pa.event_id and pa.email = lower(btrim(p_email))
     and pa.status = 'accepted' and pa.deleted_at is null and e.ends_at > now() - interval '30 days'
  returning pa.event_id into ev;
  if not found then return false; end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (ev, p_user_id, 'participant', 'profile.update', p_participant_id, jsonb_build_object('public', p_public));
  return true;
end $$;
revoke all on function public.save_badge_profile(uuid, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.save_badge_profile(uuid, text, text, boolean, uuid) to service_role;

-- F3: same as 20261016215756, except a LinkedIn the attendee set themselves (linkedin_set_at) is kept.
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
     and pa.dietary_notes is not distinct from p_dietary_notes
     and (pa.linkedin_set_at is not null or pa.linkedin_url is not distinct from p_linkedin_url) then
    return 'UNCHANGED';
  end if;
  if email_changed and exists (select 1 from participants where event_id = p_event_id and email = p_email and id <> pa.id) then
    return 'CONFLICT_DUPLICATE_EMAIL';
  end if;
  if not p_dry_run then
    update participants
       set email = p_email, first_name = p_first_name, last_name = p_last_name, search_text = p_search_text,
           dietary_notes = p_dietary_notes, updated_at = now(),
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
revoke all on function public.ingest_sheet_row(uuid, text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.ingest_sheet_row(uuid, text, text, text, text, text, text, text, boolean) to service_role;
