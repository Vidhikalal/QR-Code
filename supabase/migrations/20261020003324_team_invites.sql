-- SPEC §5.5 / F15 (S11b): the name-only opt-in directory and invites, accepted by the invitee.
create table team_invites (
  team_id uuid not null,
  participant_id uuid not null,
  event_id uuid not null,
  invited_by uuid references participants on delete set null,
  created_at timestamptz not null default now(),
  primary key (team_id, participant_id),
  foreign key (team_id, event_id) references teams (id, event_id) on delete cascade,
  foreign key (participant_id, event_id) references participants (id, event_id) on delete cascade
);
create index team_invites_participant on team_invites (participant_id);
alter table team_invites enable row level security;

alter table email_outbox drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (kind in ('pass_issued', 'pass_reissued', 'rsvp', 'team_invite'));

create or replace function public._participant_team() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.team_id is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.team_id is not distinct from old.team_id then return new; end if;
  end if;
  perform 1 from teams where id = new.team_id for update;
  if (select count(*) from participants where team_id = new.team_id and id <> new.id) >= 4 then
    raise exception 'team_full' using errcode = 'check_violation', constraint = 'team_size';
  end if;
  new.looking_for_team := false;  -- in a team now: out of the teammate directory
  delete from team_invites where participant_id = new.id;
  return new;
end $$;

create or replace function public.team_join(p_participant_id uuid, p_email text, p_user_id uuid, p_code text default null, p_team_id uuid default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; ev events%rowtype; t uuid;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
  select * into ev from events where id = pa.event_id;
  if not ev.teams_open then return 'CLOSED'; end if;
  if pa.team_id is not null then return 'IN_A_TEAM'; end if;
  if p_team_id is null then
    select id into t from teams where event_id = pa.event_id and join_code = p_code;
  else
    select id into t from teams where id = p_team_id and event_id = pa.event_id
      and exists (select 1 from team_invites where team_id = p_team_id and participant_id = pa.id);
  end if;
  if t is null then return 'BAD_CODE'; end if;
  begin
    update participants set team_id = t where id = pa.id;
  exception
    when check_violation then return 'TEAM_FULL';
    when foreign_key_violation then return 'BAD_CODE';  -- its last member left (and deleted it) while we waited
  end;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'team.join', t);
  return 'JOINED';
end $$;

-- Own accepted row, same live event, space on the team; an invite never adds a member.
create function public.team_invite(p_participant_id uuid, p_email text, p_user_id uuid, p_invitee_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; ev events%rowtype;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
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
         team_id = null, looking_for_team = false,
         updated_at = now()
   where id = pa.id;
  update passes set revoked_at = now(), revoke_reason = 'deleted' where participant_id = pa.id and revoked_at is null;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = pa.id and status in ('pending', 'sending');
  delete from badges where participant_id = pa.id;
  delete from team_invites where participant_id = pa.id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'participant.delete', pa.id);
  return jsonb_build_object('code', 'DELETED', 'photoPath', pa.photo_path);
end $$;

-- Same RSVP answer, with the directory opt-in in the Yes transaction. One signature avoids ambiguous defaults.
drop function public.rsvp_respond(text, boolean, text, boolean, text, text, text, text);
create function public.rsvp_respond(
  p_token_hash text, p_going boolean,
  p_linkedin_url text default null, p_public boolean default null, p_dietary_notes text default null,
  p_emergency_name text default null, p_emergency_phone text default null, p_emergency_relation text default null,
  p_looking_for_team boolean default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.rsvp_token_hash = p_token_hash and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;

  if p_going then
    update participants set looking_for_team = p_looking_for_team where id = pa.id and p_looking_for_team is not null;
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
revoke all on function public.rsvp_respond(text, boolean, text, boolean, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.rsvp_respond(text, boolean, text, boolean, text, text, text, text, boolean) to service_role;

