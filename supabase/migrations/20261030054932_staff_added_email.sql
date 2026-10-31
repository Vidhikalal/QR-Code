-- SPEC F9 step 1 (v0.11.12): adding someone who already has an account as staff emails them a Sign in link.
-- Until now they were added silently (the auth server only emails addresses without an account). The email
-- goes through the outbox like every other one: queued here, drained after the response, retried on failure.
-- Its recipient is a staff account on an event, not a participant, so participant_id becomes optional.
alter table email_outbox
  alter column participant_id drop not null,
  add column event_id uuid references events on delete cascade,
  add column user_id  uuid references auth.users on delete cascade,
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check
    check (kind in ('pass_issued', 'pass_reissued', 'rsvp', 'team_invite', 'rsvp_reminder', 'profile_reminder', 'staff_added')),
  -- A participant's email names only the participant; a staff email names only the account and the event.
  add constraint email_outbox_recipient check (
    case when kind = 'staff_added' then participant_id is null and event_id is not null and user_id is not null
         else participant_id is not null and event_id is null and user_id is null end);

create index email_outbox_user  on email_outbox (user_id)  where user_id is not null;
create index email_outbox_event on email_outbox (event_id) where event_id is not null;
-- One staff email waiting per account and event; it reads the role when it is sent, so it covers role changes.
create unique index outbox_one_staff_inflight on email_outbox (user_id, event_id)
  where kind = 'staff_added' and status in ('pending', 'sending');

-- As in 20261016215756, plus the staff_added email when the account already exists.
create or replace function public.invite_staff(p_event_id uuid, p_email text, p_role staff_role, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; email_norm text := lower(btrim(p_email)); result text;
begin
  select id into uid from auth.users where lower(email) = email_norm limit 1;
  if uid is not null then
    insert into event_staff (event_id, user_id, role) values (p_event_id, uid, p_role)
    on conflict (event_id, user_id) do update set role = excluded.role;
    delete from staff_invites where event_id = p_event_id and email = email_norm;
    insert into email_outbox (kind, event_id, user_id) values ('staff_added', p_event_id, uid)
    on conflict (user_id, event_id) where kind = 'staff_added' and status in ('pending', 'sending') do nothing;
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
revoke all on function public.invite_staff(uuid, text, staff_role, uuid) from public, anon, authenticated;
grant execute on function public.invite_staff(uuid, text, staff_role, uuid) to service_role;

-- What the drainer needs for one staff email, read when it is sent: null once they're no longer staff there
-- (removed before it went out), so it is cancelled.
create function public.staff_email_target(p_outbox_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('email', u.email, 'name', sp.display_name, 'role', es.role, 'slug', e.slug,
           'eventName', e.name, 'startsAt', e.starts_at, 'timezone', e.timezone)
    from email_outbox o
    join event_staff es on es.event_id = o.event_id and es.user_id = o.user_id
    join events e on e.id = o.event_id
    join auth.users u on u.id = o.user_id
    left join staff_profiles sp on sp.user_id = o.user_id
   where o.id = p_outbox_id and o.kind = 'staff_added'
$$;
revoke all on function public.staff_email_target(uuid) from public, anon, authenticated;
grant execute on function public.staff_email_target(uuid) to service_role;
