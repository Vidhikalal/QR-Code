-- SPEC §11 (v0.9.1): an organizer takes back someone's RSVP, e.g. after a test. Their link stops working,
-- waiting email is cancelled, any pass is cancelled and their badge unlinked, and they are pending again
-- with no RSVP sent, so a new one can go out. The pass is revoked as 'status_change' (like a No), so a Yes
-- to the new RSVP issues a fresh one. Their profile answers and account stay.
create function public.revoke_rsvp(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from participants where id = p_participant_id and event_id = p_event_id and deleted_at is null for update;
  if not found then return 'NOT_FOUND'; end if;
  update participants set status = 'pending', rsvp_token_hash = null, rsvp_sent_at = null, updated_at = now()
   where id = p_participant_id;
  update passes set revoked_at = now(), revoke_reason = 'status_change'
   where participant_id = p_participant_id and revoked_at is null;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = p_participant_id and status in ('pending', 'sending');
  delete from badges where participant_id = p_participant_id;  -- §6.5: revoking a pass removes the badge link
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'rsvp.reset', p_participant_id);
  return 'RESET';
end $$;
revoke all on function public.revoke_rsvp(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_rsvp(uuid, uuid, uuid) to service_role;
