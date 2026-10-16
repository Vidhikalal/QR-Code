-- More v0.4 review fixes (tests: T-RSVP-03 review cases).

-- 1. F13: No also unlinks the badge, like revoke_pass() and delete_participant().
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
    delete from badges where participant_id = pa.id;  -- §6.5: revoking a pass removes the badge link
    insert into audit_log (event_id, actor_kind, action, subject_id) values (pa.event_id, 'participant', 'rsvp.no', pa.id);
  end if;
  return 'NOT_GOING';
end $$;

-- 2. F13: lock the chosen participants (in id order) before queueing, the same lock rsvp_respond() takes
-- first. Otherwise an RSVP sent while that person answers deadlocks on the outbox's in-flight index.
create or replace function public.queue_rsvps(p_event_id uuid, p_participant_ids uuid[], p_actor uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform 1 from participants where event_id = p_event_id and id = any(p_participant_ids) order by id for update;
  insert into email_outbox (participant_id, kind)
  select id, 'rsvp' from participants
   where event_id = p_event_id and id = any(p_participant_ids) and deleted_at is null and status <> 'accepted'
  on conflict (participant_id) where status in ('pending','sending') do nothing;
  get diagnostics n = row_count;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, detail)
  values (p_event_id, p_actor, 'staff', 'rsvp.send', jsonb_build_object('count', n));
  return n;
end $$;
