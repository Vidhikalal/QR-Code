-- Door (PLAN F20; user decision 2026-10-10): scan the pass, tap a BLANK badge, and it is registered
-- and linked in one step. Two calls because the phone writes the badge URL in between:
--   reserve_door_tag → (phone writes ${ME_ORIGIN}/t/<public_id>) → door_link_new_tag.
-- Any staff of the event may do this, but only for someone admitted at the door; register_tag and
-- reserve_tag (the Register page, vendor imports) stay organizer-only.

create or replace function public.reserve_door_tag(p_event_id uuid, p_staff_id uuid, p_participant_id uuid, p_public_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; n int; lbl text;
begin
  if not exists (select 1 from event_staff where event_id = p_event_id and user_id = p_staff_id) then
    return jsonb_build_object('code', 'FORBIDDEN');
  end if;
  select * into pa from participants where id = p_participant_id and event_id = p_event_id and deleted_at is null;
  if not found or pa.status <> 'accepted' then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if not exists (select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
                  where s.participant_id = pa.id and c.kind = 'door' and s.voided_at is null) then
    return jsonb_build_object('code', 'NOT_CHECKED_IN');
  end if;
  perform 1 from events where id = p_event_id for update;            -- sequential labels, as reserve_tag
  select coalesce(max(substring(label from '^B-(\d+)$')::int), 0) + 1 into n from tags where event_id = p_event_id;
  lbl := 'B-' || lpad(n::text, 4, '0');
  begin
    insert into tags (event_id, public_id, label, registered_by) values (p_event_id, p_public_id, lbl, p_staff_id);
  exception when unique_violation then
    return jsonb_build_object('code', 'PUBLIC_ID_CONFLICT');
  end;
  return jsonb_build_object('code', 'RESERVED', 'label', lbl);
end $$;

-- Confirms the chip serial of a badge THIS staff member reserved, then links it with assign_tag in the
-- same transaction (so its codes keep their meaning). Lock order participant → tag (I-21). If the link
-- fails (e.g. PARTICIPANT_HAS_TAG) the badge stays registered, so "Replace it" can use assign_tag.
create or replace function public.door_link_new_tag(
  p_event_id uuid, p_staff_id uuid, p_participant_id uuid, p_public_id text, p_uid text, p_replace boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t tags%rowtype;
begin
  if not exists (select 1 from event_staff where event_id = p_event_id and user_id = p_staff_id) then
    return jsonb_build_object('code', 'FORBIDDEN');
  end if;
  perform 1 from participants where id = p_participant_id and event_id = p_event_id for update;
  select * into t from tags where public_id = p_public_id and event_id = p_event_id for update;
  if not found then return jsonb_build_object('code', 'NOT_RESERVED'); end if;
  if t.uid is null then
    if t.registered_by <> p_staff_id then return jsonb_build_object('code', 'NOT_RESERVED'); end if;
    if p_uid is not null then
      begin
        update tags set uid = p_uid where id = t.id;
      exception when unique_violation then
        return jsonb_build_object('code', 'UID_CONFLICT');               -- this chip is already another badge
      end;
    end if;
  elsif p_uid is distinct from t.uid then
    return jsonb_build_object('code', 'NOT_RESERVED');                   -- confirmed with another chip
  end if;
  return assign_tag(p_event_id, p_staff_id, p_participant_id, p_public_id, null, p_replace)
         || jsonb_build_object('registered', true);
end $$;

do $$ declare f text; begin
  foreach f in array array['reserve_door_tag(uuid,uuid,uuid,text)', 'door_link_new_tag(uuid,uuid,uuid,text,text,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
