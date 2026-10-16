-- SPEC F3 + F13 (v0.4): the Sheet only imports applicants; organizers pick people in Passline and send
-- an RSVP. Yes accepts them (and queues their pass email), No withdraws them.

-- The RSVP link's token, stored as sha256 hex only (I-3), rotated on every RSVP email.
alter table participants
  add column rsvp_token_hash text unique check (rsvp_token_hash ~ '^[0-9a-f]{64}$'),
  add column rsvp_sent_at timestamptz;

alter table email_outbox drop constraint email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check check (kind in ('pass_issued', 'pass_reissued', 'rsvp'));

-- F3 (v0.4): one Sheet row → insert or update the applicant. The Status column is no longer read:
-- new rows are 'pending' and acceptance only comes from an RSVP Yes (or a walk-in). An accepted
-- participant whose email changes still gets a new pass at the new address.
drop function public.ingest_sheet_row(uuid, text, text, text, text, text, participant_status, text, text, boolean);
create function public.ingest_sheet_row(
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
           dietary_notes = p_dietary_notes, linkedin_url = p_linkedin_url, updated_at = now()
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
revoke all on function public.ingest_sheet_row(uuid, text, text, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.ingest_sheet_row(uuid, text, text, text, text, text, text, text, boolean)
  to service_role;

-- F13: queue RSVP emails for the chosen applicants of this event (not deleted, not already accepted).
create or replace function public.queue_rsvps(p_event_id uuid, p_participant_ids uuid[], p_actor uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into email_outbox (participant_id, kind)
  select id, 'rsvp' from participants
   where event_id = p_event_id and id = any(p_participant_ids) and deleted_at is null and status <> 'accepted'
  on conflict (participant_id) where status in ('pending','sending') do nothing;
  get diagnostics n = row_count;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, detail)
  values (p_event_id, p_actor, 'staff', 'rsvp.send', jsonb_build_object('count', n));
  return n;
end $$;
revoke all on function public.queue_rsvps(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.queue_rsvps(uuid, uuid[], uuid) to service_role;

-- F13: what the RSVP page shows. Null for an unknown token, a deleted participant or an event that ended.
-- `email` is for the server only (account creation); the route never returns it.
create or replace function public.rsvp_lookup(p_token_hash text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'participantId', pa.id,
    'email', pa.email,
    'firstName', pa.first_name,
    'status', pa.status,
    'hasAccount', exists (select 1 from auth.users u where lower(u.email) = pa.email),
    'event', jsonb_build_object('name', e.name, 'venue', e.venue, 'startsAt', e.starts_at, 'timezone', e.timezone))
    from participants pa join events e on e.id = pa.event_id
   where pa.rsvp_token_hash = p_token_hash and pa.deleted_at is null and e.ends_at > now()
$$;
revoke all on function public.rsvp_lookup(text) from public, anon, authenticated;
grant execute on function public.rsvp_lookup(text) to service_role;

-- F13: the answer. Yes → accepted, and a pass email unless they already have a pass or one on the way.
-- No → withdrawn, pass revoked, in-flight email cancelled. Both are safe to repeat.
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
    end if;
    if not exists (select 1 from passes where participant_id = pa.id and revoked_at is null) then
      -- A re-sent RSVP still waiting in the outbox would otherwise block the pass email.
      update email_outbox set status = 'cancelled', locked_until = null
       where participant_id = pa.id and kind = 'rsvp' and status in ('pending','sending');
      insert into email_outbox (participant_id, kind) values (pa.id, 'pass_issued')
      on conflict (participant_id) where status in ('pending','sending') do nothing;
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
revoke all on function public.rsvp_respond(text, boolean) from public, anon, authenticated;
grant execute on function public.rsvp_respond(text, boolean) to service_role;

-- §11 participants table, plus when the latest RSVP was emailed.
drop function public.admin_participants(uuid, participant_status, text, boolean);
create function public.admin_participants(
  p_event_id uuid, p_status participant_status default null, p_query text default null, p_no_show boolean default false
) returns table (
  id uuid, first_name text, last_name text, email text, status participant_status, source text, is_test boolean,
  external_id text, dietary_notes text, photo_path text, photo_updated_at timestamptz, pass_state text,
  live_scans int, checked_in boolean, created_at timestamptz, rsvp_sent_at timestamptz
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
         p.rsvp_sent_at
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
