-- PLAN §6.6. New email kinds. One in-flight email per participant PER KIND GROUP: a pending pass email
-- must not block a recap or a profile-link email, and vice versa.
alter table email_outbox drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (kind in ('pass_issued', 'pass_reissued', 'profile_link', 'recap'));
alter table email_outbox
  add column kind_group text generated always as (case when kind in ('pass_issued', 'pass_reissued') then 'pass' else kind end) stored;
drop index outbox_one_inflight;
create unique index outbox_one_inflight on email_outbox (participant_id, kind_group) where status in ('pending', 'sending');

-- "This is me, send my edit link" / "Email me a sign-in link". The caller has already resolved the
-- participant (from the badge, or event + email); the response to the browser is always generic.
create or replace function public.request_profile_link(p_participant_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; q uuid;
begin
  select * into pa from participants where id = p_participant_id;
  if not found or not _eligible(pa) then return 'NOT_ELIGIBLE'; end if;
  insert into email_outbox (participant_id, kind) values (pa.id, 'profile_link')
  on conflict (participant_id, kind_group) where status in ('pending', 'sending') do nothing
  returning id into q;
  return case when q is null then 'IN_FLIGHT' else 'QUEUED' end;
end $$;

-- Post-event recap (PLAN §7.10): everyone who actually came (live door scan), once.
create or replace function public.enqueue_recaps(p_event_id uuid, p_actor uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not exists (select 1 from event_staff where event_id = p_event_id and user_id = p_actor and role = 'organizer') then
    return -1;
  end if;
  insert into email_outbox (participant_id, kind)
  select pa.id, 'recap' from participants pa
   where pa.event_id = p_event_id and _eligible(pa) and not pa.is_test
     and exists (select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
                  where s.participant_id = pa.id and c.kind = 'door' and s.voided_at is null)
     and not exists (select 1 from email_outbox o where o.participant_id = pa.id and o.kind = 'recap'
                      and o.status in ('pending', 'sending', 'sent'))
  on conflict (participant_id, kind_group) where status in ('pending', 'sending') do nothing;
  get diagnostics n = row_count;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, detail)
  values (p_event_id, p_actor, 'staff', 'recap.enqueue', jsonb_build_object('count', n));
  return n;
end $$;

do $$ declare f text; begin
  foreach f in array array['request_profile_link(uuid)', 'enqueue_recaps(uuid,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
-- Re-created with only the ON CONFLICT target changed (PLAN §6.6).
-- SPEC F3 transition table for one Sheet row, keyed by (event_id, external_id) (I-14).
-- Inputs arrive validated and normalized by the app (I-12). One call = one transaction, so rows are
-- independent. With p_dry_run the same decisions are made but nothing is written (F10 "Sync now").
--
-- Beyond the SPEC table (agreed in the S3 plan):
--   * a tombstoned participant is left alone                                   → UNCHANGED
--   * not accepted → another non-accepted status, or changed name/dietary/etc.  → UPDATED
--   * a changed email that already belongs to someone else in the event        → CONFLICT_DUPLICATE_EMAIL
create or replace function public.ingest_sheet_row(
  p_event_id      uuid,
  p_external_id   text,
  p_email         text,
  p_first_name    text,
  p_last_name     text,
  p_search_text   text,
  p_status        participant_status,
  p_dietary_notes text    default null,
  p_linkedin_url  text    default null,
  p_dry_run       boolean default false
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pa participants%rowtype;
  details_changed boolean;
  email_taken boolean;
begin
  select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;

  if not found then
    if exists (select 1 from participants where event_id = p_event_id and email = p_email) then
      return 'CONFLICT_DUPLICATE_EMAIL';
    end if;
    if p_dry_run then
      return case when p_status = 'accepted' then 'PASS_QUEUED' else 'CREATED' end;
    end if;
    begin
      insert into participants (event_id, external_id, email, first_name, last_name, search_text,
                                dietary_notes, linkedin_url, status, source)
      values (p_event_id, p_external_id, p_email, p_first_name, p_last_name, p_search_text,
              p_dietary_notes, p_linkedin_url, p_status, 'sheet')
      on conflict (event_id, external_id) do nothing
      returning * into pa;
    exception when unique_violation then
      -- (event_id, email) taken by a concurrent insert under another external_id.
      return 'CONFLICT_DUPLICATE_EMAIL';
    end;
    if found then
      if p_status = 'accepted' then
        insert into email_outbox (participant_id, kind) values (pa.id, 'pass_issued')
        on conflict (participant_id, kind_group) where status in ('pending','sending') do nothing;
        return 'PASS_QUEUED';
      end if;
      return 'CREATED';
    end if;
    -- A concurrent request inserted this external_id first: continue as an existing row.
    select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;
  end if;

  if pa.deleted_at is not null then
    return 'UNCHANGED';
  end if;

  details_changed := pa.first_name    is distinct from p_first_name
                  or pa.last_name     is distinct from p_last_name
                  or pa.dietary_notes is distinct from p_dietary_notes
                  or pa.linkedin_url  is distinct from p_linkedin_url;
  email_taken := pa.email <> p_email and exists (
    select 1 from participants where event_id = p_event_id and email = p_email and id <> pa.id);

  if pa.status = 'accepted' then
    if p_status = 'pending' then
      return 'IGNORED_CLEAR';  -- DECISION: an accidentally cleared cell must not kill a pass
    end if;

    if p_status = 'accepted' then
      if pa.email <> p_email then
        if email_taken then return 'CONFLICT_DUPLICATE_EMAIL'; end if;
        if not p_dry_run then
          update participants
             set email = p_email, first_name = p_first_name, last_name = p_last_name, search_text = p_search_text,
                 dietary_notes = p_dietary_notes, linkedin_url = p_linkedin_url, updated_at = now()
           where id = pa.id;
          -- Rotation on send revokes the old pass. A pending row already queued will go to the new address.
          insert into email_outbox (participant_id, kind) values (pa.id, 'pass_reissued')
          on conflict (participant_id, kind_group) where status in ('pending','sending') do nothing;
          insert into audit_log (event_id, actor_kind, action, subject_id)
          values (p_event_id, 'sheet_sync', 'participant.email_change', pa.id);
        end if;
        return 'PASS_QUEUED';
      end if;
      if not details_changed then return 'UNCHANGED'; end if;
      if not p_dry_run then
        update participants
           set first_name = p_first_name, last_name = p_last_name, search_text = p_search_text,
               dietary_notes = p_dietary_notes, linkedin_url = p_linkedin_url, updated_at = now()
         where id = pa.id;
      end if;
      return 'UPDATED';
    end if;

    -- accepted → waitlisted / rejected / withdrawn
    if email_taken then return 'CONFLICT_DUPLICATE_EMAIL'; end if;
    if not p_dry_run then
      update participants
         set status = p_status, email = p_email, first_name = p_first_name, last_name = p_last_name,
             search_text = p_search_text, dietary_notes = p_dietary_notes, linkedin_url = p_linkedin_url,
             updated_at = now()
       where id = pa.id;
      update passes set revoked_at = now(), revoke_reason = 'status_change'
       where participant_id = pa.id and revoked_at is null;
      update email_outbox set status = 'cancelled', locked_until = null
       where participant_id = pa.id and status in ('pending','sending');
    end if;
    return 'REVOKED';
  end if;

  -- Existing participant who is not accepted.
  if email_taken then return 'CONFLICT_DUPLICATE_EMAIL'; end if;
  if p_status <> 'accepted' and pa.status = p_status and pa.email = p_email and not details_changed then
    return 'UNCHANGED';
  end if;
  if not p_dry_run then
    update participants
       set status = p_status, email = p_email, first_name = p_first_name, last_name = p_last_name,
           search_text = p_search_text, dietary_notes = p_dietary_notes, linkedin_url = p_linkedin_url,
           updated_at = now()
     where id = pa.id;
    if p_status = 'accepted' then
      insert into email_outbox (participant_id, kind) values (pa.id, 'pass_issued')
      on conflict (participant_id, kind_group) where status in ('pending','sending') do nothing;
    end if;
  end if;
  return case when p_status = 'accepted' then 'PASS_QUEUED' else 'UPDATED' end;
end $$;
revoke all on function public.ingest_sheet_row(uuid, text, text, text, text, text, participant_status, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.ingest_sheet_row(uuid, text, text, text, text, text, participant_status, text, text, boolean)
  to service_role;
create or replace function public.enqueue_pass(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; queued uuid;
begin
  select * into pa from participants where id = p_participant_id and event_id = p_event_id and deleted_at is null;
  if not found then return 'NOT_FOUND'; end if;
  if pa.status <> 'accepted' then return 'NOT_ACCEPTED'; end if;
  insert into email_outbox (participant_id, kind) values (pa.id, 'pass_reissued')
  on conflict (participant_id, kind_group) where status in ('pending', 'sending') do nothing
  returning id into queued;
  if queued is null then return 'IN_FLIGHT'; end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'pass.resend', pa.id);
  return 'QUEUED';
end $$;
revoke all on function public.enqueue_pass(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_pass(uuid, uuid, uuid) to service_role;
