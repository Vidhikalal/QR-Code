-- F15: self-invites have an explicit outcome after verifying the caller's own row.
create or replace function public.team_invite(p_participant_id uuid, p_email text, p_user_id uuid, p_invitee_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; ev events%rowtype;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
  if p_invitee_id = pa.id then return 'SELF'; end if;
  select * into ev from events where id = pa.event_id;
  if not ev.teams_open then return 'CLOSED'; end if;
  if pa.team_id is null then return 'NOT_FOUND'; end if;
  perform 1 from teams where id = pa.team_id for update;
  if (select count(*) from participants where team_id = pa.team_id) >= 4 then return 'TEAM_FULL'; end if;
  if not exists (select 1 from participants where id = p_invitee_id and event_id = pa.event_id
                   and status = 'accepted' and deleted_at is null and team_id is null and looking_for_team) then
    return 'NOT_LOOKING';
  end if;
  insert into team_invites (team_id, participant_id, event_id, invited_by)
  values (pa.team_id, p_invitee_id, pa.event_id, pa.id) on conflict do nothing;
  if not found then return 'ALREADY_INVITED'; end if;
  -- shortcut: one in-flight email per participant; a second invite is stored but not emailed. Split the index by kind if needed.
  insert into email_outbox (participant_id, kind) values (p_invitee_id, 'team_invite')
  on conflict (participant_id) where status in ('pending','sending') do nothing;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'team.invite', pa.team_id);
  return 'INVITED';
end $$;
revoke all on function public.team_invite(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.team_invite(uuid, text, uuid, uuid) to service_role;

-- RSVP Yes can update looking without touching team_id. Enforce the flag on both columns.
create or replace function public._participant_team() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.team_id is null then return new; end if;
  new.looking_for_team := false;  -- also clamp RSVP and same-team preference updates
  if tg_op = 'UPDATE' then
    if new.team_id is not distinct from old.team_id then return new; end if;
  end if;
  perform 1 from teams where id = new.team_id for update;
  if (select count(*) from participants where team_id = new.team_id and id <> new.id) >= 4 then
    raise exception 'team_full' using errcode = 'check_violation', constraint = 'team_size';
  end if;
  delete from team_invites where participant_id = new.id;
  return new;
end $$;
revoke all on function public._participant_team() from public, anon, authenticated;
grant execute on function public._participant_team() to service_role;
create or replace trigger participants_team before insert or update of team_id, looking_for_team on participants
  for each row execute function public._participant_team();
