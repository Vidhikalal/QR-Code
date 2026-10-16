-- T-NFC-08 race fix. The first link_badge checked "taken?" and then deleted every row for the UID; a
-- link committing between those two statements was deleted, so two volunteers both got LINKED.
-- Now a volunteer only ever deletes the participant's own old link, and the (uid, event_id) primary
-- key decides who holds the badge. Only an organizer's link (p_move) removes someone else's.
create or replace function public.link_badge(p_event_id uuid, p_participant_id uuid, p_uid text, p_actor uuid, p_move boolean)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from participants where id = p_participant_id and event_id = p_event_id and deleted_at is null for update;
  if not found then return 'NOT_FOUND'; end if;
  delete from badges
   where event_id = p_event_id and (participant_id = p_participant_id or (p_move and uid = p_uid));
  insert into badges (uid, event_id, participant_id) values (p_uid, p_event_id, p_participant_id);
  -- ids only (I-11): no UID in the detail.
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'badge.link', p_participant_id);
  return 'LINKED';
exception when unique_violation then
  return 'BADGE_TAKEN';   -- someone else holds the badge (or a concurrent link of it committed first)
end $$;
revoke all on function public.link_badge(uuid, uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.link_badge(uuid, uuid, text, uuid, boolean) to service_role;
