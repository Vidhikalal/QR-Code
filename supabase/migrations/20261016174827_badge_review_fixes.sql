-- Review fixes for S8 badges (T-NFC-06, T-NFC-08, T-NFC-12).

-- T-NFC-08: two links swapping badges (A: X→Y, B: Y→X) each deleted their own row and then waited on
-- the other's uncommitted delete in the unique check → deadlock → 500. Links are rare (door staff),
-- so serialize them per event before taking any row lock.
create or replace function public.link_badge(p_event_id uuid, p_participant_id uuid, p_uid text, p_actor uuid, p_move boolean)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('passline:badge_link'), hashtext(p_event_id::text));
  perform 1 from participants where id = p_participant_id and event_id = p_event_id and deleted_at is null for update;
  if not found then return 'NOT_FOUND'; end if;
  -- A volunteer only deletes the participant's own old link; the primary key decides who holds the badge.
  delete from badges
   where event_id = p_event_id and (participant_id = p_participant_id or (p_move and uid = p_uid));
  insert into badges (uid, event_id, participant_id) values (p_uid, p_event_id, p_participant_id);
  -- ids only (I-11): no UID in the detail.
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'badge.link', p_participant_id);
  return 'LINKED';
exception when unique_violation then
  return 'BADGE_TAKEN';
end $$;
revoke all on function public.link_badge(uuid, uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.link_badge(uuid, uuid, text, uuid, boolean) to service_role;

-- T-NFC-12: only accepted participants (a withdrawn person can no longer reach PATCH /api/pass to opt
-- out), and only links from events that ended at most 30 days ago (§15 retention), so a reused or
-- forgotten badge never shows a past holder.
create or replace function public.badge_profile(p_uid text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when pa.profile_public
           then jsonb_build_object('public', true, 'firstName', pa.first_name, 'lastName', pa.last_name,
                                   'linkedinUrl', pa.linkedin_url)
           else jsonb_build_object('public', false) end
    from badges b
    join participants pa on pa.id = b.participant_id
    join events e on e.id = b.event_id
   where b.uid = p_uid and pa.deleted_at is null and pa.status = 'accepted'
     and e.ends_at > now() - interval '30 days'
   order by b.linked_at desc
   limit 1
$$;
revoke all on function public.badge_profile(text) from public, anon, authenticated;
grant execute on function public.badge_profile(text) to service_role;

-- T-NFC-06: revoking a pass (§11, reason 'manual') must stop the badge too, not only the QR.
-- Same signature and behaviour as 20260924072215_admin.sql, plus the unlink.
create or replace function public.revoke_pass(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from participants where id = p_participant_id and event_id = p_event_id for update;
  if not found then return 'NOT_FOUND'; end if;
  update passes set revoked_at = now(), revoke_reason = 'manual' where participant_id = p_participant_id and revoked_at is null;
  if not found then return 'NO_ACTIVE_PASS'; end if;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = p_participant_id and status in ('pending', 'sending');
  delete from badges where participant_id = p_participant_id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'pass.revoke', p_participant_id);
  return 'REVOKED';
end $$;
revoke all on function public.revoke_pass(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_pass(uuid, uuid, uuid) to service_role;
