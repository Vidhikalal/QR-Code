-- SPEC §5.2 / §6.5 / §8 (NFC note), v0.3: NFC badges linked to participants, per event.

create table badges (
  uid            text not null check (uid ~ '^([0-9a-f]{2}){4,10}$'),
  event_id       uuid not null references events on delete cascade,
  participant_id uuid not null unique,                        -- one badge per participant
  linked_at      timestamptz not null default now(),
  primary key (uid, event_id),                                -- links are per event; also the lookup index
  foreign key (participant_id, event_id) references participants (id, event_id) on delete cascade
);
-- I-6: the init migration's RLS loop ran once, so new tables enable it themselves (no policies).
alter table badges enable row level security;
revoke all on badges from anon, authenticated;

-- §6.5 linking. Volunteers may only link a badge nobody else holds; organizers (p_move) take it over.
-- The participant row lock serializes links for one person; the primary key settles races on one badge.
create or replace function public.link_badge(p_event_id uuid, p_participant_id uuid, p_uid text, p_actor uuid, p_move boolean)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from participants where id = p_participant_id and event_id = p_event_id and deleted_at is null for update;
  if not found then return 'NOT_FOUND'; end if;
  if not p_move and exists (select 1 from badges where uid = p_uid and event_id = p_event_id
                             and participant_id <> p_participant_id) then
    return 'BADGE_TAKEN';
  end if;
  delete from badges where event_id = p_event_id and (uid = p_uid or participant_id = p_participant_id);
  insert into badges (uid, event_id, participant_id) values (p_uid, p_event_id, p_participant_id);
  -- ids only (I-11): no UID in the detail.
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'badge.link', p_participant_id);
  return 'LINKED';
exception when unique_violation then
  return 'BADGE_TAKEN';   -- a concurrent link of the same badge committed first
end $$;
revoke all on function public.link_badge(uuid, uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.link_badge(uuid, uuid, text, uuid, boolean) to service_role;

-- §8 NFC note: resolve the badge within the checkpoint's event, then the one decision path (I-2).
-- A badge linked only elsewhere resolves to null → NOT_FOUND after record_scan's steps 1–3.
create or replace function public.record_badge_scan(
  p_checkpoint_id uuid, p_staff_user_id uuid, p_badge_uid text, p_client_scan_id uuid, p_client_scanned_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid;
begin
  select b.participant_id into pid
    from badges b join checkpoints c on c.event_id = b.event_id
   where c.id = p_checkpoint_id and b.uid = p_badge_uid;
  return record_scan(p_checkpoint_id, p_staff_user_id, 'nfc', null, pid, p_client_scan_id, p_client_scanned_at);
end $$;
revoke all on function public.record_badge_scan(uuid, uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_badge_scan(uuid, uuid, text, uuid, timestamptz) to service_role;

-- §5.1 tombstone, now also deleting the badge link. Same signature as 20260924072215_admin.sql.
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
         updated_at = now()
   where id = pa.id;
  update passes set revoked_at = now(), revoke_reason = 'deleted' where participant_id = pa.id and revoked_at is null;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = pa.id and status in ('pending', 'sending');
  delete from badges where participant_id = pa.id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'participant.delete', pa.id);
  return jsonb_build_object('code', 'DELETED', 'photoPath', pa.photo_path);
end $$;
revoke all on function public.delete_participant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_participant(uuid, uuid, uuid) to service_role;
