-- Review fixes for v0.4 (accounts + RSVP). Each has a test in tests/int (T-ING-13, F9, T-RSVP-02/03).

-- 1. F3: an email change in the Sheet invalidates the RSVP link that went to the old address.
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
     and pa.linkedin_url  is not distinct from p_linkedin_url then
    return 'UNCHANGED';
  end if;
  if email_changed and exists (select 1 from participants where event_id = p_event_id and email = p_email and id <> pa.id) then
    return 'CONFLICT_DUPLICATE_EMAIL';
  end if;
  if not p_dry_run then
    update participants
       set email = p_email, first_name = p_first_name, last_name = p_last_name, search_text = p_search_text,
           dietary_notes = p_dietary_notes, linkedin_url = p_linkedin_url, updated_at = now(),
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

-- 2. F9: re-inviting someone who already has an account (e.g. made by an earlier invite email, no password
-- yet) also drops their pending invite, so the old role can't come back when they sign in.
create or replace function public.invite_staff(p_event_id uuid, p_email text, p_role staff_role, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; email_norm text := lower(btrim(p_email)); result text;
begin
  select id into uid from auth.users where lower(email) = email_norm limit 1;
  if uid is not null then
    insert into event_staff (event_id, user_id, role) values (p_event_id, uid, p_role)
    on conflict (event_id, user_id) do update set role = excluded.role;
    delete from staff_invites where event_id = p_event_id and email = email_norm;
    result := 'ADDED';
  else
    insert into staff_invites (event_id, email, role) values (p_event_id, email_norm, p_role)
    on conflict (event_id, email) do update set role = excluded.role;
    result := 'INVITED';
  end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (p_event_id, p_actor, 'staff', 'staff.invite', uid, jsonb_build_object('role', p_role, 'result', result));
  return result;
end $$;

-- 3. F13: a Yes only issues a pass when it accepts someone, and never over an organizer's revoke
-- (only they can issue a new one, with "Resend pass").
create or replace function public.rsvp_respond(p_token_hash text, p_going boolean)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.rsvp_token_hash = p_token_hash and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;

  if p_going then
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
    insert into audit_log (event_id, actor_kind, action, subject_id) values (pa.event_id, 'participant', 'rsvp.no', pa.id);
  end if;
  return 'NOT_GOING';
end $$;

-- 4. F4/F13: the drainer stores a new RSVP token only while it still holds the job. An answer that
-- cancelled the job after it was claimed (e.g. No from the previous link) stops the resend.
create or replace function public.set_rsvp_token(p_outbox_id uuid, p_token_hash text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid;
begin
  select participant_id into pid from email_outbox
   where id = p_outbox_id and kind = 'rsvp' and status = 'sending' for update;
  if not found then return false; end if;
  update participants set rsvp_token_hash = p_token_hash, rsvp_sent_at = now() where id = pid;
  return true;
end $$;
revoke all on function public.set_rsvp_token(uuid, text) from public, anon, authenticated;
grant execute on function public.set_rsvp_token(uuid, text) to service_role;
