-- F12 (v0.7.1): "Add attendee" can add someone who is not RSVPed yet: a pending applicant, sent nothing.
-- Organizers then send their RSVP like anyone else's (F13), e.g. to see the RSVP email.
-- The old 8-argument signature is dropped so PostgREST can't pick the wrong overload.
drop function public.add_walk_in(uuid, uuid, text, text, text, text, boolean, boolean);

create function public.add_walk_in(
  p_event_id uuid, p_organizer_id uuid, p_email text, p_first_name text, p_last_name text, p_search_text text,
  p_check_in boolean, p_send_pass boolean, p_not_rsvped boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid; door_id uuid; scan jsonb;
begin
  begin
    insert into participants (event_id, email, first_name, last_name, search_text, status, source)
    values (p_event_id, p_email, p_first_name, p_last_name, p_search_text,
            case when p_not_rsvped then 'pending' else 'accepted' end::participant_status, 'walk_in')
    returning id into new_id;
  exception when unique_violation then
    return jsonb_build_object('code', 'CONFLICT_DUPLICATE_EMAIL');
  end;
  -- A pending applicant gets no pass and no check-in (the route also refuses that combination).
  if p_send_pass and not p_not_rsvped then
    insert into email_outbox (participant_id, kind) values (new_id, 'pass_issued');
  end if;
  if p_check_in and not p_not_rsvped then
    select id into door_id from checkpoints where event_id = p_event_id and kind = 'door';
    scan := case when door_id is null then jsonb_build_object('code', 'CHECKPOINT_NOT_FOUND')
                 else record_scan(door_id, p_organizer_id, 'manual', null, new_id, gen_random_uuid(), now()) end;
  end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_organizer_id, 'staff', case when p_not_rsvped then 'participant.applicant' else 'participant.walk_in' end, new_id);
  return jsonb_build_object('code', 'CREATED', 'participantId', new_id, 'scan', scan);
end $$;
revoke all on function public.add_walk_in(uuid, uuid, text, text, text, text, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.add_walk_in(uuid, uuid, text, text, text, text, boolean, boolean, boolean) to service_role;
